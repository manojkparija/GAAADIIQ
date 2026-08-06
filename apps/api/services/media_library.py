"""
One home for every vehicle image, whatever uploaded it.

Brochure ingestion and dealer listing uploads both put pictures of cars into the
product, and until now they did it in two unrelated ways: brochures into the
vehicle_media table, listings into a JSON array of URLs on the listing row. The
same photograph arriving by both routes was stored twice, and neither copy knew
about the other.

This module is the single write path. It stores a file once, records it in
vehicle_media, and returns the row — so the second caller to offer the same
bytes gets a reference to the first caller's file instead of another copy.

Deduplication is two-stage, because the two hashes catch different things:

  content_hash  exact bytes. The same embedded object reused across pages, or
                the identical file uploaded twice.
  phash         the same photograph re-encoded, resized or recompressed. A
                manufacturer press shot reused between a brochure and a dealer
                pack shares no bytes at all, so an exact hash sees two images.
"""
from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING, Sequence

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.media_audit import AuditAction
from models.media_version import MediaEventType
from models.vehicle_media import ListingMedia, VehicleMedia
from services import pdf_ingest
from services.media_audit import log_audit
from services.media_index import media_index
from services.media_storage import StorageError, get_storage
from services.version_history import record_version

if TYPE_CHECKING:
    from models.car import Car

logger = logging.getLogger("gaadiiq.media_library")

# Bit distance below which two perceptual hashes are treated as the same
# picture. Ten of sixty-four is the conventional working threshold: re-encoding
# and rescaling move a handful of bits, while genuinely different photographs
# sit far higher — a red car and a green one measured 29 apart in testing.
PHASH_MATCH_DISTANCE = 10

# Bounded because the scan is a linear comparison in Python, not an indexed
# lookup. Newest-first is the right order: a duplicate almost always arrives
# near in time to its twin, from the same brochure batch or the same dealer.
PHASH_SCAN_LIMIT = 500


async def _find_exact(db: AsyncSession, content_hash: str | None) -> VehicleMedia | None:
    if not content_hash:
        return None
    return (await db.execute(
        select(VehicleMedia).where(VehicleMedia.content_hash == content_hash).limit(1)
    )).scalar_one_or_none()


async def _find_near(db: AsyncSession, phash: str | None) -> VehicleMedia | None:
    """
    The closest stored image within PHASH_MATCH_DISTANCE, or None.

    Closest rather than first match: two brochures of the same model can both be
    near, and reusing the nearest keeps the reference pointing at the picture
    that is actually the same shot.
    """
    if not phash:
        return None

    candidates = (await db.execute(
        select(VehicleMedia)
        .where(VehicleMedia.phash.is_not(None))
        .order_by(VehicleMedia.created_at.desc())
        .limit(PHASH_SCAN_LIMIT)
    )).scalars().all()

    best: VehicleMedia | None = None
    best_distance = PHASH_MATCH_DISTANCE + 1
    for candidate in candidates:
        distance = pdf_ingest.hamming_distance(phash, candidate.phash)
        if distance is not None and distance < best_distance:
            best, best_distance = candidate, distance

    if best is not None and best_distance <= PHASH_MATCH_DISTANCE:
        logger.info(
            "Reusing media %s for a near-duplicate upload (distance %d)",
            best.id, best_distance,
        )
        return best
    return None


async def store_image(
    db: AsyncSession,
    data: bytes,
    content_type: str,
    *,
    key_prefix: str,
    source_name: str,
    make: str | None = None,
    model: str | None = None,
    variant: str | None = None,
    model_year: int | None = None,
    category: str | None = None,
    dedupe: bool = True,
) -> VehicleMedia:
    """
    Store one image in the library and return its row, reusing an existing row
    when the same picture is already held.

    Tags are filled in only where the row does not already have them: a brochure
    knows the variant a photograph belongs to more precisely than a dealer
    listing does, and the first caller to supply a field should not have it
    overwritten by a later, vaguer one.
    """
    content_hash = __import__("hashlib").sha256(data).hexdigest()
    phash = pdf_ingest.perceptual_hash(data)

    if dedupe:
        existing = await _find_exact(db, content_hash) or await _find_near(db, phash)
        if existing is not None:
            existing.make = existing.make or make
            existing.model = existing.model or model
            existing.variant = existing.variant or variant
            existing.model_year = existing.model_year or model_year
            existing.category = existing.category or category
            return existing

    storage = get_storage()
    sniffed = pdf_ingest.sniff_image(data)
    ext = sniffed[0] if sniffed else "jpg"
    key = f"{key_prefix.rstrip('/')}/{content_hash[:24]}.{ext}"

    obj = await storage.save(key, data, content_type)

    thumbnail_key: str | None = None
    thumb = pdf_ingest.make_thumbnail(data)
    if thumb:
        thumb_bytes, thumb_type = thumb
        try:
            thumbnail_key = (await storage.save(
                pdf_ingest.thumbnail_key(obj.key), thumb_bytes, thumb_type
            )).key
        except StorageError as exc:
            # The original is stored; a missing thumbnail is a degraded gallery.
            logger.warning("Could not store thumbnail for %s: %s", obj.key, exc)

    webp_key_val: str | None = None
    webp = pdf_ingest.make_webp(data)
    if webp and content_type != "image/webp":  # Only convert if not already WebP
        webp_bytes, webp_type = webp
        try:
            webp_key_val = (await storage.save(
                pdf_ingest.webp_key(obj.key), webp_bytes, webp_type
            )).key
        except StorageError as exc:
            # The original is stored; a missing WebP is a degraded gallery.
            logger.warning("Could not store WebP derivative for %s: %s", obj.key, exc)

    width, height = pdf_ingest.image_dimensions(data)
    exif_data = pdf_ingest.extract_exif(data)

    row = VehicleMedia(
        storage_key=obj.key,
        thumbnail_key=thumbnail_key,
        webp_key=webp_key_val,
        content_type=content_type,
        size_bytes=obj.size_bytes,
        width=width,
        height=height,
        source_pdf_name=source_name[:500],
        content_hash=content_hash,
        phash=phash,
        make=make,
        model=model,
        variant=variant,
        model_year=model_year,
        category=category,
        exif=exif_data,
    )
    db.add(row)
    await db.flush()

    # Record version history: created event
    await record_version(
        db,
        media_id=row.id,
        event_type=MediaEventType.CREATED,
        new_value={
            "make": make,
            "model": model,
            "variant": variant,
            "model_year": model_year,
            "category": category,
            "storage_key": obj.key,
        },
    )

    # Log audit: upload event
    await log_audit(
        db,
        media_id=row.id,
        action=AuditAction.UPLOAD,
        audit_data={
            "filename": source_name,
            "size_bytes": obj.size_bytes,
            "content_type": content_type,
        },
    )

    await media_index.index_media(row)

    # WAVE 3: Non-blocking ML enrichment.
    #
    # Each block is gated on its settings flag. The flags existed but nothing
    # read them, so every upload tried to load CLIP and YOLOv8 regardless —
    # models that need ~2GB and cannot load on the current Render plan. The
    # attempt failed on each upload, was swallowed into a warning, and left the
    # column null: the cost of loading with none of the benefit, repeated per
    # image. Set ENABLE_EMBEDDINGS / ENABLE_OCR / ENABLE_SAFETY_DETECTION once
    # there is enough memory to serve them.
    if settings.enable_embeddings:
        try:
            from services.embeddings_clip import embed_image_bytes
            embedding = await embed_image_bytes(data)
            if embedding:
                row.embedding_vector = embedding
        except Exception as e:
            logger.warning(f"Failed to generate embedding for {row.id}: {e}")

    if settings.enable_ocr:
        try:
            from services.ocr_tesseract import ocr_image_bytes
            ocr_result = await ocr_image_bytes(data)
            if ocr_result:
                row.ocr_text = ocr_result.get("text")
                row.ocr_confidence = ocr_result.get("confidence")
                row.ocr_entities = ocr_result.get("entities")
        except Exception as e:
            logger.warning(f"Failed to extract OCR for {row.id}: {e}")

    if settings.enable_safety_detection:
        try:
            from services.safety_detection import detect_nsfw
            nsfw_score = await detect_nsfw(data)
            if nsfw_score is not None:
                row.nsfw_score = nsfw_score
        except Exception as e:
            logger.warning(f"Failed to detect NSFW for {row.id}: {e}")

        try:
            from services.safety_detection import detect_license_plate
            plate_result = await detect_license_plate(data)
            if plate_result:
                row.license_plate_detected = plate_result.get("detected", False)
                row.license_plate_bbox = plate_result.get("bbox")
                if plate_result.get("confidence"):
                    row.safety_metadata = {"license_plate_confidence": plate_result.get("confidence")}
        except Exception as e:
            logger.warning(f"Failed to detect license plate for {row.id}: {e}")

    await db.flush()
    return row


async def attach_to_listing(
    db: AsyncSession,
    listing_id,
    media: VehicleMedia,
) -> None:
    """
    Link an image to a listing, appending it to the end of its gallery.

    Idempotent: re-attaching an image a listing already shows is a no-op rather
    than a duplicate row, which matters because deduplication above means two
    different uploads can resolve to the same media row.
    """
    already = (await db.execute(
        select(ListingMedia).where(
            ListingMedia.listing_id == listing_id,
            ListingMedia.media_id == media.id,
        )
    )).scalar_one_or_none()
    if already is not None:
        return

    count = len((await db.execute(
        select(ListingMedia.media_id).where(ListingMedia.listing_id == listing_id)
    )).scalars().all())

    db.add(ListingMedia(listing_id=listing_id, media_id=media.id, position=count))


async def urls_for_cars(
    db: AsyncSession,
    cars: "Sequence[Car]",
    bucket: str | None = None,
    per_car: int = 8,
) -> dict[uuid.UUID, list[str]]:
    """
    Gallery URLs for a page of catalogue cars, keyed by car id.

    Cars carry no image column. An admin uploads a photograph against a
    vehicle's identity — make, model, year — before deciding which catalogue row
    it belongs to, so the association is resolved here at read time rather than
    stored as a foreign key. That also means one upload serves every car row
    for the model, which is the point.

    Matching is case-insensitive on make and model, since the media table holds
    free text from a brochure or an admin's typing ("Maruti" vs "maruti") while
    the catalogue is curated.

    `bucket` filters to the surface being rendered: "new" for the New Cars
    pages, "used" for Used Cars. Images marked "both", and the ones stored
    before the column existed (NULL), match either — otherwise every image
    uploaded before this feature would vanish from the site.

    One query for the whole page rather than one per car: a 100-car page would
    otherwise issue 100 round trips to Postgres.
    """
    if not cars:
        return {}

    # Group the page's cars by their identity so a single query can cover them.
    wanted: dict[tuple[str, str, int], list[uuid.UUID]] = {}
    for car in cars:
        if not car.make or not car.model:
            continue
        wanted.setdefault(
            (car.make.strip().lower(), car.model.strip().lower(), car.year), []
        ).append(car.id)
    if not wanted:
        return {}

    conditions = [
        and_(
            func.lower(func.trim(VehicleMedia.make)) == make,
            func.lower(func.trim(VehicleMedia.model)) == model,
            VehicleMedia.model_year == year,
        )
        for (make, model, year) in wanted
    ]

    q = select(VehicleMedia).where(or_(*conditions))
    if bucket in ("new", "used"):
        q = q.where(
            or_(
                VehicleMedia.media_bucket == bucket,
                VehicleMedia.media_bucket == "both",
                VehicleMedia.media_bucket.is_(None),
            )
        )
    # Hero shot first, then the admin's ordering, then oldest first so the
    # sequence is stable between requests.
    q = q.order_by(
        VehicleMedia.is_primary.desc().nullslast(),
        VehicleMedia.sort_order.asc().nullslast(),
        VehicleMedia.created_at.asc(),
    )

    rows = (await db.execute(q)).scalars().all()

    storage = get_storage()
    out: dict[uuid.UUID, list[str]] = {car.id: [] for car in cars}
    for media in rows:
        if not media.make or not media.model:
            continue
        key = (media.make.strip().lower(), media.model.strip().lower(), media.model_year)
        for car_id in wanted.get(key, ()):
            if len(out[car_id]) < per_car:
                out[car_id].append(storage.url_for(media.webp_key or media.storage_key))
    return out


async def urls_for_listing(db: AsyncSession, listing_id) -> list[str]:
    """
    A listing's gallery URLs, in order, derived from the linked media.

    Derived at read time rather than stored, for the same reason vehicle_media
    holds a key and not a URL: moving storage backend or CDN then needs no data
    migration.
    """
    rows = (await db.execute(
        select(VehicleMedia, ListingMedia.position)
        .join(ListingMedia, ListingMedia.media_id == VehicleMedia.id)
        .where(ListingMedia.listing_id == listing_id)
        .order_by(ListingMedia.position)
    )).all()

    storage = get_storage()
    return [storage.url_for(m.storage_key) for m, _ in rows]
