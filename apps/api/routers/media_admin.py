"""
Admin image upload — the catalogue's own photography, uploaded once.

    POST /media-admin/inspect   admin — what the filenames suggest, before saving
    POST /media-admin/upload    admin — store images with their metadata
    PATCH /media-admin/{id}     admin — correct one image's metadata

Distinct from the brochure pipeline, which extracts pictures from a PDF and
infers what they show. Here an admin supplies the photography and states what
it is, so the metadata is authoritative rather than inferred — and the mandatory
fields are enforced, because an untagged image is invisible to every catalogue
surface and therefore not worth storing.

Both paths write to the same vehicle_media table through services.media_library,
so a photograph offered by both is stored once.

NOTE: deliberately NOT using `from __future__ import annotations` — see the note
in routers/brochures.py about PEP 563 and slowapi's wrapper.
"""
import logging
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.dependencies import get_admin_user
from core.limiter import limiter
from db.session import get_db
from models.user import User
from models.vehicle_media import ImageCategory, VehicleMedia
from services import filename_metadata, media_library, pdf_ingest
from services.media_index import media_index
from services.media_storage import StorageError, get_storage

logger = logging.getLogger("gaadiiq.media_admin")

router = APIRouter(prefix="/media-admin", tags=["media-admin"])

# Bounded per request rather than per file: a hundred 20 MB photographs is a
# 2 GB request whatever the per-file cap says, and the instance has to hold
# each one while it is hashed and thumbnailed.
MAX_FILES_PER_REQUEST = 50


class SuggestedMetadata(BaseModel):
    filename: str
    make: str | None = None
    model: str | None = None
    variant: str | None = None
    model_year: int | None = None
    image_category: str | None = None
    colour: str | None = None
    exif_hints: dict | None = None


class UploadedImage(BaseModel):
    id: uuid.UUID
    filename: str
    url: str
    thumbnail_url: str | None = None
    make: str | None = None
    model: str | None = None
    variant: str | None = None
    model_year: int | None = None
    image_category: str | None = None
    colour: str | None = None
    is_primary: bool = False
    sort_order: int = 0
    # True when this file matched one already stored, so the admin can see that
    # forty uploads produced thirty-eight new images rather than silently
    # wondering where two went.
    deduplicated: bool = False


class UploadResult(BaseModel):
    stored: int
    deduplicated: int
    rejected: int
    images: list[UploadedImage] = []
    errors: list[str] = []


class MetadataPatch(BaseModel):
    make: str | None = None
    model: str | None = None
    variant: str | None = None
    model_year: int | None = None
    category: str | None = None
    fuel_type: str | None = None
    transmission: str | None = None
    image_category: str | None = None
    colour: str | None = None
    alt_text: str | None = None
    seo_keywords: str | None = None
    source: str | None = None
    copyright: str | None = None
    license: str | None = None
    is_primary: bool | None = None
    sort_order: int | None = None


def _category(value: str | None) -> ImageCategory | None:
    """Map an incoming string to the fixed vocabulary, or reject it by name."""
    if not value:
        return None
    try:
        return ImageCategory(value.strip().lower())
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Unknown image category {value!r}. Valid values: "
                + ", ".join(c.value for c in ImageCategory)
            ),
        )


def _default_alt_text(make, model, variant, year, category) -> str:
    """
    A usable alt text when the admin did not write one.

    Generated rather than left blank because a gallery of unlabelled images is
    unusable with a screen reader, and "image" as alt text is worse than a
    plain description of what the picture is of.
    """
    words = [str(year) if year else "", make or "", model or "", variant or ""]
    label = " ".join(w for w in words if w).strip()
    if category:
        readable = category.value.replace("_", " ")
        return f"{label} — {readable}".strip(" —") or readable
    return label or "Vehicle image"


@router.post("/inspect", response_model=list[SuggestedMetadata])
@limiter.limit("30/minute")
async def inspect_filenames(
    request: Request,
    files: list[UploadFile] = File(...),
    admin: User = Depends(get_admin_user),
):
    """
    What the filenames suggest, without storing anything.

    Lets the admin screen show a pre-filled grid to correct before committing —
    which is the point of BR-004: photography arrives named, not tagged, and
    retyping the make and model for two hundred files is the reason bulk
    uploads do not happen.

    Reads only the names; the bodies are never touched, so this is cheap enough
    to call as soon as files are selected.
    """
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"At most {MAX_FILES_PER_REQUEST} files per request.",
        )

    out: list[SuggestedMetadata] = []
    for f in files:
        name = f.filename or ""
        parsed = filename_metadata.parse(name).as_dict()
        out.append(SuggestedMetadata(filename=name, **parsed))
    return out


@router.post("/upload", response_model=UploadResult, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/minute")
async def upload_images(
    request: Request,
    files: list[UploadFile] = File(...),
    # Mandatory per BR-002. Deliberately not defaulted: an image with no make
    # and model cannot be found by any catalogue surface, so storing one is
    # just paying for a file nobody will ever see.
    make: str = Form(...),
    model: str = Form(...),
    model_year: int = Form(...),
    category: str = Form(..., description="Body type: SUV, Sedan, Hatchback…"),
    fuel_type: str = Form(...),
    transmission: str = Form(...),
    image_category: str = Form(..., description="Front, Interior, Boot…"),
    # Optional.
    variant: str | None = Form(None),
    colour: str | None = Form(None),
    alt_text: str | None = Form(None),
    seo_keywords: str | None = Form(None),
    source: str | None = Form(None),
    copyright: str | None = Form(None),
    license: str | None = Form(None),
    primary_filename: str | None = Form(
        None, description="Which file is the hero shot for this vehicle"
    ),
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Store one or many vehicle images with their metadata.

    Every file in a request shares the vehicle fields — that is how the screen
    works, because an admin uploads a set of photographs of one car. Per-image
    differences (a different angle, a different colour) are corrected afterwards
    with PATCH, which is cheaper than making the upload form per-file.

    Files that match something already stored are linked, not copied, and
    reported as deduplicated so the counts add up on screen.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files supplied.")
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"At most {MAX_FILES_PER_REQUEST} files per request.",
        )

    chosen_category = _category(image_category)
    result = UploadResult(stored=0, deduplicated=0, rejected=0)
    max_bytes = settings.media_max_upload_mb * 1024 * 1024

    for index, upload in enumerate(files):
        name = upload.filename or f"upload-{index}"
        data = await upload.read()

        if not data:
            result.rejected += 1
            result.errors.append(f"{name}: empty file")
            continue
        if len(data) > max_bytes:
            result.rejected += 1
            result.errors.append(
                f"{name}: {len(data) / 1024 / 1024:.1f} MB exceeds the "
                f"{settings.media_max_upload_mb} MB limit"
            )
            continue

        # Magic bytes, not the Content-Type header or the extension: trusting
        # either is how something executable gets stored with a .jpg name.
        sniffed = pdf_ingest.sniff_image(data)
        if not sniffed:
            result.rejected += 1
            result.errors.append(
                f"{name}: not a supported image (JPEG, PNG, WebP, TIFF, HEIC)"
            )
            continue
        _, content_type = sniffed

        # Per-file hints fill only what the shared form left blank — the admin's
        # values always win over a filename guess.
        hint = filename_metadata.parse(name)

        try:
            media = await media_library.store_image(
                db, data, content_type,
                key_prefix=f"car-images/{make}/{model}/{model_year}/{chosen_category.value}".lower().replace(" ", "-"),
                source_name=name,
                make=make, model=model,
                variant=variant or hint.variant,
                model_year=model_year, category=category,
            )
        except StorageError as exc:
            result.rejected += 1
            result.errors.append(f"{name}: storage rejected the file ({exc})")
            continue

        was_duplicate = media.image_category is not None or media.uploaded_by is not None

        media.fuel_type = media.fuel_type or fuel_type
        media.transmission = media.transmission or transmission
        media.image_category = media.image_category or chosen_category or hint.image_category
        media.colour = media.colour or colour or hint.colour
        media.source = media.source or source
        media.copyright = media.copyright or copyright
        media.license = media.license or license
        media.seo_keywords = media.seo_keywords or seo_keywords
        media.uploaded_by = media.uploaded_by or admin.id
        media.alt_text = media.alt_text or alt_text or _default_alt_text(
            make, model, variant, model_year, media.image_category
        )
        if not media.sort_order:
            media.sort_order = index

        if primary_filename and name == primary_filename:
            await _make_primary(db, media)

        if was_duplicate:
            result.deduplicated += 1
        else:
            result.stored += 1

        storage = get_storage()
        result.images.append(UploadedImage(
            id=media.id,
            filename=name,
            url=storage.url_for(media.storage_key),
            thumbnail_url=storage.url_for(media.thumbnail_key) if media.thumbnail_key else None,
            make=media.make, model=media.model, variant=media.variant,
            model_year=media.model_year,
            image_category=media.image_category.value if media.image_category else None,
            colour=media.colour, is_primary=media.is_primary,
            sort_order=media.sort_order, deduplicated=was_duplicate,
        ))

    await db.commit()

    # After the commit: the rows are the source of truth and the index is a
    # cache of them, so a failure here must not roll back a stored upload.
    stored_rows = (await db.execute(
        select(VehicleMedia).where(VehicleMedia.id.in_([i.id for i in result.images]))
    )).scalars().all() if result.images else []
    await media_index.index_many(stored_rows)

    if not result.images:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"message": "No image could be stored.", "errors": result.errors},
        )
    return result


async def _make_primary(db: AsyncSession, media: VehicleMedia) -> None:
    """
    Mark one image the hero shot, demoting whatever held it before.

    Enforced here rather than by a constraint because "primary" is only
    meaningful within a vehicle, and a partial unique index over three nullable
    columns behaves differently on every backend.
    """
    await db.execute(
        update(VehicleMedia)
        .where(
            VehicleMedia.make == media.make,
            VehicleMedia.model == media.model,
            VehicleMedia.variant.is_(media.variant) if media.variant is None
            else VehicleMedia.variant == media.variant,
            VehicleMedia.id != media.id,
        )
        .values(is_primary=False)
    )
    media.is_primary = True


@router.patch("/{media_id}", response_model=UploadedImage)
@limiter.limit("60/minute")
async def update_metadata(
    request: Request,
    media_id: uuid.UUID,
    patch: MetadataPatch,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Correct one image's metadata.

    This is what makes AI-suggested values safe to apply at all: anything the
    filename parser or the vision model got wrong is fixable without
    re-uploading the file. Only supplied fields change — omitting one leaves it
    as it was, rather than blanking it.
    """
    from services.version_history import record_version
    from models.media_version import MediaEventType

    media = (await db.execute(
        select(VehicleMedia).where(VehicleMedia.id == media_id)
    )).scalar_one_or_none()
    if media is None:
        raise HTTPException(status_code=404, detail="Image not found")

    # Capture old values for version history
    old_value = {
        "make": media.make,
        "model": media.model,
        "variant": media.variant,
        "model_year": media.model_year,
        "category": media.category,
        "image_category": media.image_category.value if media.image_category else None,
        "colour": media.colour,
        "fuel_type": media.fuel_type,
        "transmission": media.transmission,
    }

    data = patch.model_dump(exclude_unset=True)

    if "image_category" in data:
        media.image_category = _category(data.pop("image_category"))
    make_primary = data.pop("is_primary", None)

    for field, value in data.items():
        setattr(media, field, value)

    if make_primary:
        await _make_primary(db, media)
    elif make_primary is False:
        media.is_primary = False

    await db.commit()

    # Record version change if metadata was updated
    if data or "image_category" in patch.model_dump(exclude_unset=True):
        from services.media_audit import log_audit
        from models.media_audit import AuditAction

        new_value = {
            "make": media.make,
            "model": media.model,
            "variant": media.variant,
            "model_year": media.model_year,
            "category": media.category,
            "image_category": media.image_category.value if media.image_category else None,
            "colour": media.colour,
            "fuel_type": media.fuel_type,
            "transmission": media.transmission,
        }
        await record_version(
            db,
            media_id=media_id,
            event_type=MediaEventType.METADATA_UPDATED,
            actor_id=admin.id,
            old_value=old_value,
            new_value=new_value,
        )

        # Log audit: edit event
        await log_audit(
            db,
            media_id=media_id,
            action=AuditAction.EDIT,
            actor_id=admin.id,
            metadata={"fields_changed": list(data.keys())},
        )
        await db.commit()

    await db.refresh(media)
    await media_index.index_media(media)

    storage = get_storage()
    return UploadedImage(
        id=media.id,
        filename=media.source_pdf_name,
        url=storage.url_for(media.storage_key),
        thumbnail_url=storage.url_for(media.thumbnail_key) if media.thumbnail_key else None,
        make=media.make, model=media.model, variant=media.variant,
        model_year=media.model_year,
        image_category=media.image_category.value if media.image_category else None,
        colour=media.colour, is_primary=media.is_primary, sort_order=media.sort_order,
    )


@router.get("/dealer-images")
async def get_dealer_images(
    user: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Fetch recent images uploaded by the admin user, for dashboard display.
    Returns recent vehicle_media records with their metadata and URLs.
    """
    from sqlalchemy import desc

    media = (await db.execute(
        select(VehicleMedia)
        .where(VehicleMedia.uploaded_by == user.id)
        .order_by(desc(VehicleMedia.created_at))
        .limit(50)
    )).scalars().all()

    storage = get_storage()
    images = []
    for m in media:
        images.append({
            "id": str(m.id),
            "filename": m.source_pdf_name,
            "url": storage.url_for(m.storage_key),
            "thumbnail_url": storage.url_for(m.thumbnail_key) if m.thumbnail_key else None,
            "make": m.make,
            "model": m.model,
            "variant": m.variant,
            "model_year": m.model_year,
            "image_category": m.image_category.value if m.image_category else None,
            "colour": m.colour,
            "created_at": m.created_at.isoformat(),
        })

    return {"images": images, "total": len(images)}


@router.get("/{media_id}/versions", tags=["media-versions"])
async def get_versions(
    media_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """Fetch version history for a media item."""
    from uuid import UUID
    from services.version_history import get_version_history

    try:
        mid = UUID(media_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid media_id format")

    versions = await get_version_history(db, mid)
    return {
        "media_id": media_id,
        "versions": [
            {
                "id": v.id,
                "event_type": v.event_type.value if hasattr(v.event_type, 'value') else str(v.event_type),
                "actor_id": str(v.actor_id) if v.actor_id else None,
                "old_value": v.old_value,
                "new_value": v.new_value,
                "created_at": v.created_at.isoformat(),
            }
            for v in versions
        ],
    }


@router.post("/{media_id}/versions/{version_id}/rollback", tags=["media-versions"], status_code=200)
async def rollback_version(
    media_id: str,
    version_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_admin_user),
):
    """Rollback media to a previous version."""
    from uuid import UUID
    from services.version_history import rollback_to_version

    try:
        mid = UUID(media_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid media_id format")

    result = await rollback_to_version(db, mid, version_id, actor_id=user.id)
    if not result:
        raise HTTPException(status_code=404, detail="Version not found or media not found")

    await db.commit()
    return {"status": "success", "message": f"Rolled back to version {version_id}"}


@router.get("/{media_id}/audit", tags=["media-audit"])
async def get_audit_log(
    media_id: str,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_admin_user),
):
    """Fetch audit log for a media item."""
    from uuid import UUID
    from services.media_audit import get_audit_log as get_audit

    try:
        mid = UUID(media_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid media_id format")

    audits = await get_audit(db, mid, limit=limit)
    return {
        "media_id": media_id,
        "total": len(audits),
        "audits": [
            {
                "id": a.id,
                "action": a.action.value if hasattr(a.action, 'value') else str(a.action),
                "actor_id": str(a.actor_id) if a.actor_id else None,
                "ip_address": a.ip_address,
                "metadata": a.metadata,
                "created_at": a.created_at.isoformat(),
            }
            for a in audits
        ],
    }
