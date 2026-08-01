"""
Brochure ingestion: admin uploads a car PDF, the API extracts images and data.

    POST   /brochures/upload            admin only — upload and process a PDF
    GET    /brochures/jobs              admin only — ingestion history
    GET    /brochures/jobs/{id}         admin only — one job with its results
    DELETE /brochures/jobs/{id}         admin only — remove a job and its files
    GET    /brochures/images            public     — extracted images, filterable
    GET    /media/{key}                 public     — serve a stored image

Upload is admin-only and rate-limited: it accepts a large file, runs a PDF
parser over it, and calls a paid model. Left open, it would be both a denial-of
-service target and a way to spend someone else's Gemini budget.

NOTE: deliberately NOT using `from __future__ import annotations`. PEP 563
turns annotations into strings, and slowapi's @limiter.limit wrapper leaves
FastAPI unable to resolve them — it then treats the body and DB dependency as
query parameters, so every request 422s.
"""
import asyncio
import logging
import os
import tempfile
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.dependencies import get_admin_user
from core.limiter import limiter
from db.session import get_db
from models.user import User
from models.vehicle_media import (
    ExtractedVehicle,
    IngestionStatus,
    MediaKind,
    MediaView,
    PdfIngestionJob,
    VehicleMedia,
)
from services import media_backfill, pdf_ingest
from services.media_index import media_index
from services.media_storage import StorageError, get_storage

logger = logging.getLogger("gaadiiq.brochures")

router = APIRouter(prefix="/brochures", tags=["brochures"])
media_router = APIRouter(prefix="/media", tags=["media"])

# Full manufacturer catalogues run to hundreds of megabytes — a real one in
# testing was 266 MB. The old 50 MB cap was sized for when the upload was held
# in memory, where anything larger killed the process; now that it is spooled
# to disk, file size costs disk rather than RAM and the limit can reflect what
# brochures actually weigh.
#
# Overridable because the right value depends on the instance's disk, which
# this code cannot see.
MAX_PDF_MB = int(os.getenv("MAX_PDF_MB", "300"))
MAX_PDF_BYTES = MAX_PDF_MB * 1024 * 1024
UPLOAD_CHUNK_BYTES = 1024 * 1024


async def _read_capped(file: UploadFile, limit: int) -> bytes:
    """
    Buffer an upload in memory, refusing anything past `limit`.

    Kept for callers that genuinely need the bytes. Request handlers should use
    _spool_to_disk instead — see the note there.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(UPLOAD_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(
                status_code=413,
                detail=f"PDF exceeds {limit // (1024 * 1024)} MB",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@asynccontextmanager
async def _spool_to_disk(file: UploadFile, limit: int):
    """
    Write the upload to a temp file, yield its path, and always clean up.

    Streaming the images was not enough on a 512 MB instance: the PDF itself
    was held three times over — the chunk list, the joined bytes, and
    PyMuPDF's own copy of the stream. A 40 MB brochure therefore cost ~120 MB
    on top of a baseline that already carries onnxruntime and the Qdrant
    client, and the process was OOM-killed with no traceback.

    On disk, the bytes are held zero times: PyMuPDF reads the file, and peak
    memory is one 1 MB chunk regardless of brochure size.
    """
    tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    total = 0
    try:
        try:
            while True:
                chunk = await file.read(UPLOAD_CHUNK_BYTES)
                if not chunk:
                    break
                total += len(chunk)
                if total > limit:
                    raise HTTPException(
                        status_code=413,
                        detail=f"PDF exceeds {limit // (1024 * 1024)} MB",
                    )
                await asyncio.to_thread(tmp.write, chunk)
        finally:
            tmp.close()
        yield Path(tmp.name), total
    finally:
        # The temp file outlives the request only if this is missed, and a
        # 50 MB leak per upload would fill the instance's disk.
        Path(tmp.name).unlink(missing_ok=True)


# Below this, a PDF has no usable prose — a page number and a copyright line
# come to about this much.
MIN_USEFUL_TEXT_CHARS = 200


def _why_no_vehicles(text: str, engine: str) -> str:
    """
    Explain an empty extraction in terms the operator can act on.

    Car brochures are frequently laid out as artwork with the words baked into
    the images, so there is nothing for a language model to read no matter how
    well it is configured. That is a different problem from an unreachable
    model, and a different one again from a model that read the text and found
    no vehicles in it — but all three arrive here as "0 vehicles".
    """
    stripped = (text or "").strip()

    # These all mean "the PDF had no text layer, so the pages were read as
    # images" — and then differ in how that went. Reporting them alike is how
    # an operator ends up rechecking a correctly-set API key.
    if engine == "gemini-vision":
        return (
            "This PDF has no text layer, so its pages were read as images by "
            "Gemini — but no vehicle details could be made out. Try a brochure "
            "page showing the variant or specification table, or raise "
            "PDF_VISION_DPI if the print is small."
        )
    if engine == "groq-vision":
        return (
            "This PDF has no text layer, so its pages were read as images by "
            "Groq (free) — but no vehicle details could be made out. Try a "
            "brochure page showing the variant or specification table, or raise "
            "PDF_VISION_DPI if the print is small. Gemini may read some "
            "brochures better."
        )
    if engine == "ollama-vision":
        return (
            "This PDF has no text layer, so its pages were read as images by "
            "Ollama — but no vehicle details could be made out. Gemini "
            "(paid API) may give better results for some brochures."
        )
    if engine == "vision-rate-limited":
        return (
            "This PDF has no text layer, so its pages were sent to a vision "
            "model as images — and every provider was rate-limited. This clears "
            "by itself: wait a minute and retry the job. Your API keys are "
            "fine. If it keeps happening, brochures are being ingested faster "
            "than the free tier allows — raise the provider's tier, or lower "
            "PDF_VISION_MAX_PAGES so each brochure spends fewer tokens."
        )
    if engine == "vision-call-failed":
        return (
            "This PDF has no text layer, so its pages were sent to a vision "
            "model as images — and every provider failed. The reason is in the "
            "API logs (search for 'extraction failed'); a quota, an invalid "
            "key, or an unreachable model are the usual causes. Setting "
            "GROQ_API_KEY gives a free hosted fallback that does not depend on "
            "Gemini quota or on a self-hosted Ollama."
        )
    if engine == "vision-render-failed":
        return (
            "This PDF has no text layer and its pages could not be rendered "
            "to images, so there was nothing to send to the AI. See the API "
            "logs for the rendering error."
        )
    if engine == "vision-parse-failed":
        return (
            "This PDF has no text layer. The vision model read the rendered "
            "pages and replied, but the reply was not the expected JSON — see "
            "the API logs for what came back."
        )
    if len(stripped) < MIN_USEFUL_TEXT_CHARS:
        return (
            f"No readable text in this PDF ({len(stripped)} characters) — the "
            "brochure's words are part of its artwork. Reading the pages as "
            "images is attempted automatically: Gemini (paid API) first, then "
            "Groq (free, hosted), then Ollama (free, self-hosted). Set "
            "GEMINI_API_KEY or GROQ_API_KEY on the API, or ensure Ollama is "
            "reachable. The images were extracted and kept regardless."
        )
    if engine == "none":
        return (
            "The brochure text was read from the PDF, but no AI model was "
            "available to interpret it. Set GEMINI_API_KEY or GROQ_API_KEY on "
            "the API, or check that Ollama is reachable."
        )
    return (
        f"{engine} read {len(stripped)} characters from this brochure but "
        "found no vehicle records in it."
    )


# ── Response shapes ───────────────────────────────────────────────────────────

class MediaOut(BaseModel):
    id: uuid.UUID
    url: str
    # Nullable: thumbnail generation can fail on an image the decoder dislikes,
    # and callers fall back to `url` rather than showing a broken image.
    thumbnail_url: str | None = None
    content_type: str
    width: int | None = None
    height: int | None = None
    make: str | None = None
    model: str | None = None
    variant: str | None = None
    colour: str | None = None
    model_year: int | None = None
    category: str | None = None
    kind: str = "unknown"
    view: str = "unknown"
    source_pdf_name: str
    page_number: int | None = None
    created_at: datetime


class VehicleOut(BaseModel):
    id: uuid.UUID
    make: str | None = None
    model: str | None = None
    variant: str | None = None
    model_year: int | None = None
    price_inr: int | None = None
    fuel_type: str | None = None
    transmission: str | None = None
    body_type: str | None = None
    colours: list | None = None
    features: list | None = None
    specs: dict | None = None
    confidence: float
    review_status: str


class JobOut(BaseModel):
    id: uuid.UUID
    source_pdf_name: str
    # Stored since the first version but never returned, so the admin list had
    # no size to show and rendered "NaN MB".
    file_size_bytes: int = 0
    status: str
    error_message: str | None = None
    page_count: int
    image_count: int
    vehicle_count: int
    ai_engine: str | None = None
    created_at: datetime
    completed_at: datetime | None = None


class JobDetailOut(JobOut):
    images: list[MediaOut] = []
    vehicles: list[VehicleOut] = []


def _media_out(m: VehicleMedia) -> MediaOut:
    # The URL is derived from the key at read time, never stored — that is what
    # lets the storage backend change without a data migration.
    storage = get_storage()
    return MediaOut(
        id=m.id,
        url=storage.url_for(m.storage_key),
        thumbnail_url=storage.url_for(m.thumbnail_key) if m.thumbnail_key else None,
        content_type=m.content_type,
        width=m.width,
        height=m.height,
        make=m.make,
        model=m.model,
        variant=m.variant,
        colour=m.colour,
        model_year=m.model_year,
        category=m.category,
        kind=m.kind.value if m.kind else "unknown",
        view=m.view.value if m.view else "unknown",
        source_pdf_name=m.source_pdf_name,
        page_number=m.page_number,
        created_at=m.created_at,
    )


# ── Ingestion ─────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=JobDetailOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def upload_brochure(
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a brochure PDF. Extracts images and vehicle data, stores both.

    Images are extracted first and kept even if the AI step fails: a brochure's
    photographs are the expensive part, and an offline model must not discard
    them.
    """
    # Spooled to disk, never held in memory: the PDF used to exist three times
    # over (chunk list, joined bytes, PyMuPDF's copy of the stream), which
    # OOM-killed the instance on a large brochure before any image was touched.
    async with _spool_to_disk(file, MAX_PDF_BYTES) as (pdf_path, size):
        if not size:
            raise HTTPException(status_code=400, detail="Empty file")
        # Content sniffing, not the filename: trusting a client-supplied
        # extension is how an executable ends up on disk named .pdf. Only the
        # header is read — enough to identify the format.
        header = await asyncio.to_thread(pdf_path.read_bytes) if size <= 1024 else None
        if header is None:
            with open(pdf_path, "rb") as fh:
                header = await asyncio.to_thread(fh.read, 1024)
        if not pdf_ingest.is_pdf(header):
            raise HTTPException(status_code=400, detail="File is not a PDF")

        return await _ingest_pdf(pdf_path, size, file.filename, None, db)


async def _ingest_pdf(
    pdf_path: Path,
    size: int,
    filename: str | None,
    admin: User | None,
    db: AsyncSession,
) -> "JobDetailOut":
    """
    The ingestion itself, given a PDF already on disk.

    Split out so the upload handler can hold the temp file open with `async
    with` without indenting this whole body inside it.
    """
    job = PdfIngestionJob(
        source_pdf_name=(filename or "upload.pdf")[:500],
        file_size_bytes=size,
        status=IngestionStatus.processing,
        uploaded_by=admin.id if admin else None,
    )
    db.add(job)
    await db.flush()

    storage = get_storage()

    try:
        text = pdf_ingest.extract_text(pdf_path)
        # Streamed, not listed: holding every image at once reached ~492 MB on a
        # 300-image brochure (~1.6 MB per photo), which OOM-kills a small
        # instance mid-request. Each image below is stored and then dropped, so
        # peak memory is the PDF plus one image.
        image_stream = pdf_ingest.iter_images(pdf_path)
    except pdf_ingest.PdfIngestError as exc:
        job.status = IngestionStatus.failed
        job.error_message = str(exc)[:2000]
        job.completed_at = datetime.now(timezone.utc)
        await db.commit()
        raise HTTPException(status_code=422, detail=f"Could not read PDF: {exc}") from exc

    stored = 0
    storage_failures = 0
    last_storage_error = ""
    # The loop stays lazy — materialising it here would undo the streaming and
    # restore the OOM. The handler wraps the loop because iter_images is a
    # generator: a PDF PyMuPDF cannot open raises on first iteration, not at
    # the call above, and would otherwise escape as a 500 rather than the 422
    # callers get today.
    try:
        for index, img in enumerate(image_stream):
            sniffed = pdf_ingest.sniff_image(img["data"])
            if not sniffed:
                continue  # not an image we can serve; skip rather than store junk
            ext, content_type = sniffed
            key = pdf_ingest.build_key(job.id, index, ext)
            try:
                obj = await storage.save(key, img["data"], content_type)
                logger.info("Stored image %s (%d bytes) for job %s", key, len(img["data"]), job.id)
            except StorageError as exc:
                logger.error("StorageError storing image %s: %s", key, exc)
                storage_failures += 1
                last_storage_error = str(exc)
                continue
            except Exception as exc:
                logger.error("Unexpected error storing image %s: %s (type: %s)", key, exc, type(exc).__name__)
                storage_failures += 1
                last_storage_error = f"{type(exc).__name__}: {exc}"
                continue

            width, height = img.get("width"), img.get("height")
            if not width or not height:
                width, height = pdf_ingest.image_dimensions(img["data"])

            # Built here, while the bytes are still in hand — the streaming loop
            # drops each image straight after storing it, so a later pass would
            # have to re-download every original to thumbnail it.
            thumb_key: str | None = None
            thumb = await asyncio.to_thread(pdf_ingest.make_thumbnail, img["data"])
            if thumb:
                thumb_bytes, thumb_type = thumb
                candidate = pdf_ingest.thumbnail_key(obj.key)
                try:
                    thumb_obj = await storage.save(candidate, thumb_bytes, thumb_type)
                    thumb_key = thumb_obj.key
                except StorageError as exc:
                    # The original is already stored; losing its thumbnail is a
                    # degraded gallery, not a failed ingestion.
                    logger.warning("Could not store thumbnail %s: %s", candidate, exc)

            db.add(VehicleMedia(
                storage_key=obj.key,
                thumbnail_key=thumb_key,
                content_type=content_type,
                size_bytes=obj.size_bytes,
                width=width,
                height=height,
                source_pdf_name=job.source_pdf_name,
                page_number=img.get("page_number"),
                content_hash=img.get("content_hash"),
                phash=img.get("phash"),
                job_id=job.id,
            ))
            stored += 1
    except pdf_ingest.PdfIngestError as exc:
        job.status = IngestionStatus.failed
        job.error_message = str(exc)[:2000]
        job.completed_at = datetime.now(timezone.utc)
        await db.commit()
        raise HTTPException(status_code=422, detail=f"Could not read PDF: {exc}") from exc

    # A brochure whose every image was rejected by storage is a failure, not a
    # job that happens to have no pictures. Reporting "completed, 0 images"
    # would hide a misconfigured bucket behind a result that looks like a
    # brochure the parser simply found nothing in.
    if storage_failures and not stored:
        job.status = IngestionStatus.failed
        job.error_message = f"No images could be stored: {last_storage_error}"[:2000]
        job.completed_at = datetime.now(timezone.utc)
        await db.commit()
        raise HTTPException(
            status_code=502,
            detail=f"Storage rejected every image. {last_storage_error}",
        )

    # The path is passed so a brochure with no text layer can still be read:
    # its pages are rendered and shown to Gemini as images.
    vehicles, engine = await pdf_ingest.extract_vehicles(text, source=pdf_path)
    if not vehicles:
        # Three very different causes produce "0 vehicles", and the UI cannot
        # tell them apart from the count alone. Guessing sent an operator to
        # check an API key that was already set.
        job.error_message = _why_no_vehicles(text, engine)[:2000]
    vehicle_rows = [ExtractedVehicle(job_id=job.id, **v) for v in vehicles]
    for row in vehicle_rows:
        db.add(row)
    # Flushed so the rows have IDs to point images at.
    await db.flush()

    media_rows = (await db.execute(
        select(VehicleMedia).where(VehicleMedia.job_id == job.id)
    )).scalars().all()

    logger.info("Job %s: stored=%d media_rows=%d vehicles=%d", job.id, stored, len(media_rows), len(vehicles))

    _tag_media_from_vehicles(media_rows, vehicle_rows)

    # Only the angle and the colour actually need looking at the picture; make,
    # model and year come from the brochure text far more reliably than from a
    # model guessing at a photograph. Gated because it costs one vision call per
    # batch of images on top of the extraction itself.
    if settings.media_classification_enabled and media_rows:
        await _classify_media(media_rows, storage)

    job.page_count = pdf_ingest.page_count(pdf_path)
    job.image_count = stored
    job.vehicle_count = len(vehicles)
    job.ai_engine = engine
    job.status = IngestionStatus.completed
    job.completed_at = datetime.now(timezone.utc)

    await db.commit()

    # After the commit, and bulk rather than per-image: the rows are the source
    # of truth and the index is a cache of them, so indexing must not be able to
    # roll back an ingestion that already succeeded.
    await media_index.index_many(media_rows)

    return await _job_detail(db, job.id)


def _consensus(values: list) -> object | None:
    """The single distinct non-empty value, or None when they disagree."""
    distinct = {v for v in values if v}
    return distinct.pop() if len(distinct) == 1 else None


def _tag_media_from_vehicles(
    media: list[VehicleMedia],
    vehicles: list[ExtractedVehicle],
) -> None:
    """
    Copy make/model/variant/year/category from the brochure's vehicles onto its
    images, so the catalogue can find a photograph by what it depicts.

    Previously this only ran when the brochure yielded exactly one vehicle, and
    otherwise left every image untagged — which meant a multi-variant brochure,
    the normal shape for a manufacturer PDF, produced images no surface could
    query. It also meant a failed extraction left them untagged even when the
    make and model were never in doubt.

    Now each field is taken on consensus, independently: a brochure covering
    Dzire VXi, ZXi and ZXi+ agrees on make, model and year but not on variant,
    so those three are set and variant is left for an admin. A field is only
    left blank when the brochure genuinely disagrees about it.
    """
    if not media or not vehicles:
        return

    make = _consensus([v.make for v in vehicles])
    model = _consensus([v.model for v in vehicles])
    variant = _consensus([v.variant for v in vehicles])
    model_year = _consensus([v.model_year for v in vehicles])
    category = _consensus([v.body_type for v in vehicles])

    # Only meaningful with a single vehicle: with several, an image cannot be
    # attributed to one of them without looking at it.
    only_id = vehicles[0].id if len(vehicles) == 1 else None

    for m in media:
        # Never overwrite something already known — a later AI classification
        # pass or an admin edit is better evidence than brochure-wide consensus.
        m.make = m.make or make
        m.model = m.model or model
        m.variant = m.variant or variant
        m.model_year = m.model_year or model_year
        m.category = m.category or category
        if only_id and m.extracted_vehicle_id is None:
            m.extracted_vehicle_id = only_id


async def _classify_media(media: list[VehicleMedia], storage) -> None:
    """
    Ask a vision model what each image shows: exterior/interior/swatch, its
    angle, and the body colour.

    Runs on thumbnails, not originals. A 400px WebP is ample for "is this a
    cabin or a colour swatch, and which way is the car facing", and sending
    full-resolution press shots would multiply the token cost of a brochure by
    its image count for no gain in accuracy.

    Failures are swallowed per batch: classification is enrichment, and an
    unclassified image is still a stored, tagged, browsable image.
    """
    payloads: list[tuple[VehicleMedia, bytes]] = []
    for m in media:
        key = m.thumbnail_key or m.storage_key
        try:
            payloads.append((m, await storage.load(key)))
        except Exception as exc:
            logger.debug("Could not load %s for classification: %s", key, exc)

    if not payloads:
        return

    try:
        results = await pdf_ingest.classify_images([data for _, data in payloads])
    except pdf_ingest.RateLimited as exc:
        logger.warning("Image classification throttled, leaving images unclassified: %s", exc)
        return
    except Exception as exc:
        logger.warning("Image classification failed: %s", exc)
        return

    for (m, _), result in zip(payloads, results):
        if not isinstance(result, dict):
            continue
        kind = _coerce_enum(MediaKind, result.get("kind"))
        view = _coerce_enum(MediaView, result.get("view"))
        if kind:
            m.kind = kind
        if view:
            m.view = view
        colour = (result.get("colour") or "").strip()
        if colour and not m.colour:
            m.colour = colour[:80]


def _coerce_enum(enum_cls, value):
    """Map a model's string onto an enum member, or None if it invented one."""
    if not value:
        return None
    try:
        return enum_cls(str(value).strip().lower())
    except ValueError:
        return None


async def _job_detail(db: AsyncSession, job_id: uuid.UUID) -> JobDetailOut:
    job = (await db.execute(
        select(PdfIngestionJob).where(PdfIngestionJob.id == job_id)
    )).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    media = (await db.execute(
        select(VehicleMedia).where(VehicleMedia.job_id == job_id)
        .order_by(VehicleMedia.page_number, VehicleMedia.created_at)
    )).scalars().all()
    vehicles = (await db.execute(
        select(ExtractedVehicle).where(ExtractedVehicle.job_id == job_id)
        .order_by(desc(ExtractedVehicle.confidence))
    )).scalars().all()

    return JobDetailOut(
        id=job.id,
        source_pdf_name=job.source_pdf_name,
        file_size_bytes=job.file_size_bytes or 0,
        status=job.status.value,
        error_message=job.error_message,
        page_count=job.page_count,
        image_count=job.image_count,
        vehicle_count=job.vehicle_count,
        ai_engine=job.ai_engine,
        created_at=job.created_at,
        completed_at=job.completed_at,
        images=[_media_out(m) for m in media],
        vehicles=[VehicleOut(
            id=v.id, make=v.make, model=v.model, variant=v.variant,
            model_year=v.model_year, price_inr=v.price_inr, fuel_type=v.fuel_type,
            transmission=v.transmission, body_type=v.body_type, colours=v.colours,
            features=v.features, specs=v.specs, confidence=v.confidence,
            review_status=v.review_status,
        ) for v in vehicles],
    )


@router.get("/jobs", response_model=list[JobOut])
async def list_jobs(
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
):
    rows = (await db.execute(
        select(PdfIngestionJob).order_by(desc(PdfIngestionJob.created_at)).limit(limit)
    )).scalars().all()
    return [JobOut(
        id=j.id, source_pdf_name=j.source_pdf_name,
        file_size_bytes=j.file_size_bytes or 0, status=j.status.value,
        error_message=j.error_message, page_count=j.page_count,
        image_count=j.image_count, vehicle_count=j.vehicle_count,
        ai_engine=j.ai_engine, created_at=j.created_at, completed_at=j.completed_at,
    ) for j in rows]


@router.get("/jobs/{job_id}", response_model=JobDetailOut)
async def get_job(
    job_id: uuid.UUID,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    return await _job_detail(db, job_id)


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_job(
    job_id: uuid.UUID,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a job, its metadata rows, and the stored files."""
    job = (await db.execute(
        select(PdfIngestionJob).where(PdfIngestionJob.id == job_id)
    )).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    storage = get_storage()
    doomed = (await db.execute(
        select(VehicleMedia.id, VehicleMedia.storage_key, VehicleMedia.thumbnail_key)
        .where(VehicleMedia.job_id == job_id)
    )).all()

    # Files first: a failure here leaves rows pointing at real files, which is
    # recoverable. The reverse leaves orphaned files nothing knows about.
    # Thumbnails are deleted alongside their originals — they are derived from
    # the same row, so leaving them behind would orphan a file per image.
    for _, key, thumb in doomed:
        for candidate in (key, thumb):
            if not candidate:
                continue
            try:
                await storage.delete(candidate)
            except StorageError as exc:
                logger.warning("Could not delete %s: %s", candidate, exc)

    for media_id, _, _ in doomed:
        await media_index.delete_media(str(media_id))

    await db.delete(job)
    await db.commit()


class BackfillOut(BaseModel):
    scanned: int
    tagged: int
    thumbnailed: int
    hashed: int
    indexed: int
    unreadable: int
    errors: list[str] = []


@router.post("/backfill", response_model=BackfillOut)
@limiter.limit("2/hour")
async def backfill_media_endpoint(
    request: Request,
    admin: User = Depends(get_admin_user),
    db: AsyncSession = Depends(get_db),
    limit: int | None = Query(None, ge=1, le=5000, description="Cap rows touched; omit for all"),
    reindex_all: bool = Query(False, description="Also re-index rows that need no other work"),
):
    """
    Bring images stored before the enrichment pipeline up to its standard.

    Images ingested by the earlier code have a storage key and little else — no
    thumbnail, no perceptual hash, and tags only where a brochure happened to
    describe exactly one vehicle. Every catalogue surface filters on those tags,
    so without this the pipeline looks broken on existing data while working
    correctly on everything uploaded after it.

    Idempotent: only missing fields are filled, so running it twice is a no-op
    and an interrupted run can simply be started again. Rate-limited and
    admin-only because it reads and rewrites every image in storage.

    Start with `?limit=50` to see what a run does before committing to the
    whole table.
    """
    report = await media_backfill.backfill_media(db, limit=limit, reindex_all=reindex_all)
    return BackfillOut(**report.as_dict())


# ── Public read ───────────────────────────────────────────────────────────────

@router.get("/images", response_model=list[MediaOut])
async def list_images(
    db: AsyncSession = Depends(get_db),
    q: str | None = Query(None, description="Free-text search across make/model/variant"),
    make: str | None = Query(None),
    model: str | None = Query(None),
    variant: str | None = Query(None),
    model_year: int | None = Query(None),
    category: str | None = Query(None, description="Body type: Hatchback, Sedan, SUV, MUV"),
    colour: str | None = Query(None),
    kind: str | None = Query(None, description="exterior|interior|colour_swatch|feature|logo"),
    view: str | None = Query(None, description="front|front_three_quarter|side|rear|top|detail"),
    limit: int = Query(60, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """
    Catalogue photographs, filterable by what they depict. Public.

    This is the single read path behind every surface that shows vehicle
    imagery — brand, model and variant pages, comparison, the advisor, the
    dealer portal and search. Each passes the filters it cares about rather
    than keeping its own copy of the images, which is what makes one uploaded
    file appear in all of them.

    Served from OpenSearch when it is configured, and from Postgres when it is
    not. Filtering is case-insensitive on the Postgres path because brochure
    capitalisation is inconsistent ("MARUTI SUZUKI" vs "Maruti Suzuki").
    """
    # Ranked IDs from the index when it is available. None means "no index",
    # which is different from "no results" — see MediaIndex.search.
    ranked = await media_index.search(
        q, make=make, model=model, variant=variant, model_year=model_year,
        category=category, colour=colour, kind=kind, view=view,
        limit=limit, offset=offset,
    )

    if ranked is not None:
        if not ranked:
            return []
        rows = (await db.execute(
            select(VehicleMedia).where(VehicleMedia.id.in_([uuid.UUID(r) for r in ranked]))
        )).scalars().all()
        # OpenSearch returned these in rank order; the IN query does not preserve
        # it, so restore it rather than silently returning them by primary key.
        order = {r: i for i, r in enumerate(ranked)}
        rows.sort(key=lambda m: order.get(str(m.id), len(order)))
        return [_media_out(m) for m in rows]

    stmt = select(VehicleMedia)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            VehicleMedia.make.ilike(like)
            | VehicleMedia.model.ilike(like)
            | VehicleMedia.variant.ilike(like)
        )
    if make:
        stmt = stmt.where(VehicleMedia.make.ilike(f"%{make}%"))
    if model:
        stmt = stmt.where(VehicleMedia.model.ilike(f"%{model}%"))
    if variant:
        stmt = stmt.where(VehicleMedia.variant.ilike(f"%{variant}%"))
    if model_year:
        stmt = stmt.where(VehicleMedia.model_year == model_year)
    if category:
        stmt = stmt.where(VehicleMedia.category.ilike(category))
    if colour:
        stmt = stmt.where(VehicleMedia.colour.ilike(f"%{colour}%"))
    if kind:
        stmt = stmt.where(VehicleMedia.kind == kind)
    if view:
        stmt = stmt.where(VehicleMedia.view == view)
    stmt = stmt.order_by(desc(VehicleMedia.created_at)).limit(limit).offset(offset)

    try:
        rows = (await db.execute(stmt)).scalars().all()
    except (ProgrammingError, OperationalError) as exc:
        # Almost always a missing table: startup runs `alembic upgrade head`
        # but only LOGS a failure, so the API serves traffic against a database
        # that never received the migration. A bare 500 gives no clue.
        logger.error("Brochure tables unavailable: %s", exc)
        raise HTTPException(
            status_code=503,
            detail=(
                "Brochure storage is not initialised — the database migration "
                "has not been applied. Run 'alembic upgrade head' against the "
                "API database and check the startup logs for the failure."
            ),
        ) from exc

    return [_media_out(m) for m in rows]


@media_router.get("/{key:path}")
async def serve_media(key: str):
    """
    Serve a stored file.

    Only needed for local storage; with S3 the URL points straight at the
    bucket and this route is never called. Keeping it means the frontend uses
    one URL shape regardless of backend.
    """
    storage = get_storage()
    try:
        data = await storage.load(key)
    except StorageError:
        raise HTTPException(status_code=404, detail="Not found")

    sniffed = pdf_ingest.sniff_image(data)
    content_type = sniffed[1] if sniffed else "application/octet-stream"
    return Response(
        content=data,
        media_type=content_type,
        # Extracted images are immutable — the key changes when the content
        # does — so they can be cached hard.
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
