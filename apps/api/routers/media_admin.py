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
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.dependencies import get_admin_user
from core.limiter import limiter
from db.session import get_db
from models.car import BodyType, Car, FuelType, Transmission
from models.listing import Listing
from models.media_audit import AuditAction
from models.media_version import MediaEventType
from models.user import User
from models.vehicle_media import ImageCategory, VehicleMedia
from services import filename_metadata, media_library, pdf_ingest, vehicle_identity
from services.media_audit import get_audit_log as get_audit
from services.media_audit import log_audit
from services.media_index import media_index
from services.media_storage import StorageError, get_storage
from services.version_history import get_version_history, record_version, rollback_to_version

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
    id: UUID
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
    # WAVE 3 ML fields
    embedding_vector: list[float] | None = None
    ocr_text: str | None = None
    ocr_confidence: float | None = None
    ocr_entities: dict | None = None
    nsfw_score: float | None = None
    license_plate_detected: bool | None = None
    license_plate_bbox: dict | None = None
    safety_metadata: dict | None = None


class UploadResult(BaseModel):
    stored: int
    deduplicated: int
    rejected: int
    images: list[UploadedImage] = []
    errors: list[str] = []
    #: The catalogue model this upload created or matched. Images are joined to
    #: the catalogue by make, model and year at read time, so without a row
    #: here an uploaded photograph belongs to no vehicle a buyer can reach.
    catalogue_car_id: UUID | None = None
    #: True when this upload is the reason that row exists.
    catalogue_car_created: bool = False
    #: Reasons this upload will not be visible to a buyer yet — no price for a
    #: New Cars image, no advert for a Used Cars one. Plural because a "both"
    #: upload can hit each for a different reason, and reporting one while
    #: staying silent about the other is how an admin fixes half a problem and
    #: still finds an empty page.
    #:
    #: Reported at upload time rather than discovered by looking at a page that
    #: does not show the photograph and gives no reason.
    catalogue_warnings: list[str] = []


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


#: Which catalogue surface an image serves. Not the listings.listing_type enum:
#: that is exactly {new, used} and describes one advert, while an image is
#: commonly valid on both.
MEDIA_BUCKETS = ("new", "used", "both")


def _bucket(value: str | None) -> str:
    """Map an incoming bucket to the fixed vocabulary, or reject it by name."""
    normalised = (value or "both").strip().lower()
    if normalised not in MEDIA_BUCKETS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Unknown media bucket {value!r}. Valid values: "
                + ", ".join(MEDIA_BUCKETS)
            ),
        )
    return normalised


def _enum_or_none(enum_cls, value: str | None):
    """
    Map an admin's word to a catalogue enum, or None when it does not fit.

    The upload form's vocabulary is written for a person ("Hatchback",
    "Petrol", "Manual") while the catalogue stores lowercase members. A value
    outside the enum is left unset rather than rejected: the image itself is
    still worth storing, and a missing body type costs a filter facet, not the
    photograph.
    """
    if not value:
        return None
    try:
        return enum_cls(value.strip().lower())
    except ValueError:
        return None


async def _ensure_catalogue_car(
    db: AsyncSession,
    *,
    make: str,
    model: str,
    year: int,
    body_type: str | None,
    fuel_type: str | None,
    transmission: str | None,
    ex_showroom_price: Decimal | None,
) -> tuple[Car, bool]:
    """
    Find or create a catalogue model this upload is a photograph of.

    Images carry a vehicle's identity — make, model, year — and are joined to
    the catalogue on it at read time rather than by a foreign key, so that one
    upload serves every catalogue row for the model. The join has an unstated
    requirement: a catalogue row has to exist. Nothing in the upload path
    created one, so photographing a model the catalogue had never heard of
    stored an image that no page could reach.

    Variant is deliberately not part of the match, and not part of what gets
    created. Photographs are of a model, not of a trim: the same exterior
    shots serve every S-Presso whatever the badge on the boot, which is why
    the read-time join ignores variant too. Including it here meant choosing
    "VXI" on an upload form invented a second catalogue model, and one
    photograph turned a car into two — an image upload should not be deciding
    what trims a manufacturer sells.

    So: any existing row for this make, model and year is used. Only when the
    catalogue has never heard of the vehicle at all is one created, and then
    without a variant — a base entry that exists so the photograph is
    reachable, for a human to refine afterwards.

    Returns the row and whether this call created it.
    """
    # Any variant will do: they share the photographs. Prefer the one without
    # a variant — the base entry — so repeated uploads settle on the same row
    # rather than whichever trim happens to sort first.
    existing = await db.execute(
        select(Car).where(
            func.lower(func.trim(Car.make)) == make.strip().lower(),
            func.lower(func.trim(Car.model)) == model.strip().lower(),
            Car.year == year,
        ).order_by(Car.variant.is_(None).desc(), Car.created_at).limit(1)
    )
    car = existing.scalar_one_or_none()

    if car is None:
        car = Car(
            make=make.strip(),
            model=model.strip(),
            variant=None,
            year=year,
            body_type=_enum_or_none(BodyType, body_type),
            fuel_type=_enum_or_none(FuelType, fuel_type),
            transmission=_enum_or_none(Transmission, transmission),
            ex_showroom_price=ex_showroom_price,
        )
        db.add(car)
        await db.flush()
        return car, True

    # The admin is stating a price now, so it wins over whatever was there:
    # a correction is the usual reason to type one against a model that
    # already exists. Omitting the field leaves the stored price alone rather
    # than clearing it, so uploading more photographs of a priced model does
    # not un-price it.
    if ex_showroom_price is not None:
        car.ex_showroom_price = ex_showroom_price

    # Fill only what the catalogue is missing. An existing row may have been
    # curated, and an upload form is not the place to overwrite that.
    car.body_type = car.body_type or _enum_or_none(BodyType, body_type)
    car.fuel_type = car.fuel_type or _enum_or_none(FuelType, fuel_type)
    car.transmission = car.transmission or _enum_or_none(Transmission, transmission)
    return car, False


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
    media_bucket: str = Form(
        "both",
        description="Which catalogue surface this image serves: new, used or both",
    ),
    # Optional.
    ex_showroom_price: Decimal | None = Form(
        None,
        description=(
            "The manufacturer's ex-showroom price for this model, in rupees. "
            "Required in practice for a New Cars upload: those pages only show "
            "priced models, because a grid that sorts and filters on price "
            "cannot render one without it. On-road price is not stored — it is "
            "derived from this figure, and varies by state and by what the "
            "buyer chooses."
        ),
    ),
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
    chosen_bucket = _bucket(media_bucket)

    client_ip = _client_ip(request)
    user_agent = request.headers.get("user-agent")
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

        # One spelling per manufacturer. An image finds its car by matching
        # make + model + year exactly, so "Maruti" and "Maruti Suzuki" are two
        # different vehicles as far as the catalogue is concerned — and a
        # gallery uploaded under the short name is invisible on the long one.
        make = vehicle_identity.canonical_make(make) or make
        model = vehicle_identity.canonical_model(model) or model

        try:
            media = await media_library.store_image(
                db, data, content_type,
                key_prefix=f"car-images/{make}/{model}/{model_year}/{chosen_category.value}".lower().replace(" ", "-"),
                source_name=name,
                make=make, model=model,
                variant=variant or hint.variant,
                model_year=model_year, category=category,
                # The admin is stating what this vehicle is, not guessing, so
                # their answer replaces whatever an earlier upload recorded.
                # Without this, re-uploading a file to correct its identity is
                # a no-op, and an image mis-tagged once stays lost forever.
                authoritative=True,
                # Who did it, for the audit trail. vehicle_media.uploaded_by
                # records who first introduced a file and is SET NULL when that
                # account goes; the audit row is what survives, and it is the
                # only record of a re-upload that moved an image to another
                # vehicle.
                actor_id=admin.id,
                ip_address=client_ip,
                user_agent=user_agent,
            )
        except StorageError as exc:
            result.rejected += 1
            result.errors.append(f"{name}: storage rejected the file ({exc})")
            continue

        was_duplicate = media.image_category is not None or media.uploaded_by is not None

        media.fuel_type = media.fuel_type or fuel_type
        media.transmission = media.transmission or transmission
        # Set unconditionally, unlike the fields above: re-uploading an image
        # that deduplicates to an existing row is how an admin moves it between
        # the New and Used surfaces, so the new choice must win.
        media.media_bucket = chosen_bucket
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
            embedding_vector=media.embedding_vector,
            ocr_text=media.ocr_text,
            ocr_confidence=media.ocr_confidence,
            ocr_entities=media.ocr_entities,
            nsfw_score=media.nsfw_score,
            license_plate_detected=media.license_plate_detected,
            license_plate_bbox=media.license_plate_bbox,
            safety_metadata=media.safety_metadata,
        ))

    # Give the photographs a vehicle to belong to. Done once for the batch,
    # since every file in a request shares the vehicle fields, and only when
    # something was actually stored — a request where every file was rejected
    # should not leave a catalogue entry behind.
    if result.images:
        car, created = await _ensure_catalogue_car(
            db,
            make=make,
            model=model,
            year=model_year,
            body_type=category,
            fuel_type=fuel_type,
            transmission=transmission,
            ex_showroom_price=ex_showroom_price,
        )
        result.catalogue_car_id = car.id
        result.catalogue_car_created = created
        vehicle = f"{make} {model} {model_year}"

        if car.ex_showroom_price is None and chosen_bucket in ("new", "both"):
            result.catalogue_warnings.append(
                f"{vehicle} has no ex-showroom price, so it will not appear on "
                "the New Cars pages. Add one here or on the pricing screen."
            )

        # Used Cars is built from listings — one seller's advert for one
        # vehicle — and not from the catalogue, because a used car a buyer can
        # act on is an advert someone has placed. A catalogue model has no
        # mileage, no owner history and no asking price, so showing one there
        # would offer a vehicle nobody is actually selling.
        #
        # That makes a Used Cars image invisible until such an advert exists,
        # which is not obvious from a screen whose "Show On" control implies
        # the choice is enough on its own.
        if chosen_bucket in ("used", "both"):
            advertised = await db.scalar(
                select(func.count())
                .select_from(Listing)
                .where(Listing.car_id == car.id, Listing.listing_type == "used")
            )
            if not advertised:
                result.catalogue_warnings.append(
                    f"Nobody is advertising a used {vehicle}, so this image has "
                    "nothing to appear on. Used Cars shows sellers' adverts, "
                    "not the catalogue — the image is stored against the model "
                    "and will appear on the first used listing for it."
                )

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


def _client_ip(request: Request) -> str | None:
    """
    The forwarded address, not the socket's.

    Behind Render's proxy every request appears to come from the proxy, which
    would make the audit trail record the same address for every admin in the
    country.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    return (
        forwarded.split(",")[0].strip()
        or (request.client.host if request.client else None)
    )


class VehicleImageOut(BaseModel):
    """One stored photograph, as the admin screen lists it."""

    id: UUID
    filename: str
    url: str
    thumbnail_url: str | None = None
    image_category: str | None = None
    variant: str | None = None
    colour: str | None = None
    media_bucket: str | None = None
    created_at: str
    uploaded_by: str | None = None


@router.get("/vehicle-images", response_model=list[VehicleImageOut])
@limiter.limit("60/minute")
async def list_vehicle_images(
    request: Request,
    make: str,
    model: str,
    model_year: int | None = None,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Every photograph currently showing for a vehicle.

    An admin correcting a mistake needs to see what is actually on the site for
    a car, which is not the same as what they personally uploaded recently —
    the existing dashboard listing is filtered to the current user and the last
    fifty rows, so a wrong image uploaded by a colleague, or a while ago, was
    not reachable at all.

    Matched the way the catalogue matches at read time: make and model
    case-insensitively, and year only when given, so an admin can find an image
    filed under the wrong year.
    """
    q = select(VehicleMedia).where(
        func.lower(func.trim(VehicleMedia.make)) == make.strip().lower(),
        func.lower(func.trim(VehicleMedia.model)) == model.strip().lower(),
        VehicleMedia.deleted_at.is_(None),
    )
    if model_year is not None:
        q = q.where(VehicleMedia.model_year == model_year)
    q = q.order_by(
        VehicleMedia.is_primary.desc(),
        VehicleMedia.sort_order.asc(),
        VehicleMedia.created_at.asc(),
    )

    storage = get_storage()
    return [
        VehicleImageOut(
            id=m.id,
            filename=m.source_pdf_name,
            url=storage.url_for(m.webp_key or m.storage_key),
            thumbnail_url=storage.url_for(m.thumbnail_key) if m.thumbnail_key else None,
            image_category=m.image_category.value if m.image_category else None,
            variant=m.variant,
            colour=m.colour,
            media_bucket=m.media_bucket,
            created_at=m.created_at.isoformat(),
            uploaded_by=str(m.uploaded_by) if m.uploaded_by else None,
        )
        for m in (await db.execute(q)).scalars().all()
    ]


@router.delete("/{media_id}", status_code=status.HTTP_200_OK)
@limiter.limit("60/minute")
async def remove_image(
    request: Request,
    media_id: UUID,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Take a photograph off the site.

    A picture uploaded against the wrong car, or simply a bad shot, is a
    mistake a buyer can see, and until now the only way to remove one was to
    open the database. Metadata could be corrected and an image re-pointed at
    another vehicle, but an image that should not exist anywhere had no exit.

    Marked removed rather than destroyed. The audit log and version history
    reference this row, and they hold the facts most worth keeping about a
    mistake — who uploaded it, when, what it claimed to be. Destroying the row
    would take those with it and make an accidental removal permanent. The
    stored file stays too, which is what makes restoring it instant.

    Idempotent: removing an already-removed image is not an error, because the
    caller's intent is already satisfied.
    """
    media = (await db.execute(
        select(VehicleMedia).where(VehicleMedia.id == media_id)
    )).scalar_one_or_none()
    if media is None:
        raise HTTPException(status_code=404, detail="Image not found")

    if media.deleted_at is None:
        media.deleted_at = datetime.now(timezone.utc)
        media.deleted_by = admin.id

        await record_version(
            db,
            media_id=media.id,
            event_type=MediaEventType.DELETED,
            actor_id=admin.id,
            old_value={"deleted_at": None},
            new_value={"deleted_at": media.deleted_at.isoformat()},
        )
        await log_audit(
            db,
            media_id=media.id,
            action=AuditAction.DELETE,
            actor_id=admin.id,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
            audit_data={"filename": media.source_pdf_name,
                        "vehicle": f"{media.make} {media.model} {media.model_year}"},
        )
        await db.commit()

        # The search index is a cache of the rows, so a removed image must
        # leave it too — but a failure here must not undo a removal the admin
        # has already been told about.
        try:
            await media_index.delete_media(str(media.id))
        except Exception:
            logger.warning("Could not drop %s from the search index", media.id, exc_info=True)

    return {"id": str(media.id), "deleted": True}


@router.post("/{media_id}/restore", status_code=status.HTTP_200_OK)
@limiter.limit("60/minute")
async def restore_image(
    request: Request,
    media_id: UUID,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Put a removed photograph back.

    Removal is one click and mistakes are ordinary, so the way back has to be
    as easy as the way out.
    """
    media = (await db.execute(
        select(VehicleMedia).where(VehicleMedia.id == media_id)
    )).scalar_one_or_none()
    if media is None:
        raise HTTPException(status_code=404, detail="Image not found")

    if media.deleted_at is not None:
        was = media.deleted_at.isoformat()
        media.deleted_at = None
        media.deleted_by = None

        await record_version(
            db,
            media_id=media.id,
            event_type=MediaEventType.METADATA_UPDATED,
            actor_id=admin.id,
            old_value={"deleted_at": was},
            new_value={"deleted_at": None},
        )
        await log_audit(
            db,
            media_id=media.id,
            action=AuditAction.EDIT,
            actor_id=admin.id,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("user-agent"),
            audit_data={"restored": True, "filename": media.source_pdf_name},
        )
        await db.commit()

    return {"id": str(media.id), "deleted": False}


@router.patch("/{media_id}", response_model=UploadedImage)
@limiter.limit("60/minute")
async def update_metadata(
    request: Request,
    media_id: UUID,
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
            audit_data={"fields_changed": list(data.keys())},
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
@limiter.limit("60/minute")
async def get_dealer_images(
    request: Request,
    user: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Fetch recent images uploaded by the admin user, for dashboard display.
    Returns recent vehicle_media records with their metadata and URLs.

    Rate limited because this was the one endpoint in the router without a
    limit, and a client-side effect loop hammered it several times a second for
    an extended period — each request running a 50-row query. A dashboard needs
    a handful of loads a minute; 60 leaves ample headroom while capping the
    damage a misbehaving or stale client can do.
    """
    from sqlalchemy import desc

    media = (await db.execute(
        select(VehicleMedia)
        .where(VehicleMedia.uploaded_by == user.id, VehicleMedia.deleted_at.is_(None))
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
    try:
        mid = UUID(media_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid media_id format")

    versions = await get_version_history(db, mid)
    return {
        "media_id": media_id,
        "versions": [
            {
                "id": str(v.id),
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
                "id": str(a.id),
                "action": a.action.value if hasattr(a.action, 'value') else str(a.action),
                "actor_id": str(a.actor_id) if a.actor_id else None,
                "ip_address": a.ip_address,
                "audit_data": a.audit_data,
                "created_at": a.created_at.isoformat(),
            }
            for a in audits
        ],
    }


# ── WAVE 3 Semantic Search & ML Results ──────────────────────────────────


@router.get("/search", response_model=list[dict], tags=["wave3-search"])
@limiter.limit("30/minute")
async def search_media(
    request: Request,
    q: str,
    limit: int = 10,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Semantic search across all images using CLIP embeddings.

    Returns images ranked by similarity to the search query.
    """
    if not q or len(q.strip()) == 0:
        raise HTTPException(status_code=400, detail="Search query cannot be empty")

    from services.embeddings_clip import embed_text
    query_embedding = await embed_text(q)
    if not query_embedding:
        return []

    media_rows = (await db.execute(
        select(VehicleMedia)
        .where(
            VehicleMedia.embedding_vector.isnot(None),
            VehicleMedia.deleted_at.is_(None),
        )
        .limit(100)
    )).scalars().all()

    scored = []
    for m in media_rows:
        if m.embedding_vector:
            similarity = sum(
                a * b for a, b in zip(query_embedding, m.embedding_vector)
            ) / (
                sum(a ** 2 for a in query_embedding) ** 0.5
                * sum(b ** 2 for b in m.embedding_vector) ** 0.5 + 1e-8
            )
            scored.append((m, similarity))

    scored.sort(key=lambda x: x[1], reverse=True)

    storage = get_storage()
    results = []
    for m, score in scored[:limit]:
        results.append({
            "id": str(m.id),
            "url": storage.url_for(m.storage_key),
            "make": m.make,
            "model": m.model,
            "variant": m.variant,
            "model_year": m.model_year,
            "similarity_score": float(score),
        })
    return results


@router.get("/{media_id}/ocr", tags=["wave3-ocr"])
@limiter.limit("60/minute")
async def get_ocr_results(
    media_id: UUID,
    request: Request,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve OCR extraction results for an image."""
    media = (await db.execute(
        select(VehicleMedia).where(VehicleMedia.id == media_id)
    )).scalar_one_or_none()
    if media is None:
        raise HTTPException(status_code=404, detail="Image not found")

    return {
        "media_id": str(media_id),
        "text": media.ocr_text,
        "confidence": media.ocr_confidence,
        "entities": media.ocr_entities or {},
    }


@router.get("/{media_id}/safety", tags=["wave3-safety"])
@limiter.limit("60/minute")
async def get_safety_results(
    media_id: UUID,
    request: Request,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve safety detection results for an image."""
    media = (await db.execute(
        select(VehicleMedia).where(VehicleMedia.id == media_id)
    )).scalar_one_or_none()
    if media is None:
        raise HTTPException(status_code=404, detail="Image not found")

    return {
        "media_id": str(media_id),
        "nsfw_score": media.nsfw_score,
        "license_plate_detected": media.license_plate_detected,
        "license_plate_bbox": media.license_plate_bbox,
        "safety_metadata": media.safety_metadata or {},
    }
