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

from core.dependencies import get_admin_user
from core.limiter import limiter
from db.session import get_db
from models.user import User
from models.vehicle_media import (
    ExtractedVehicle,
    IngestionStatus,
    PdfIngestionJob,
    VehicleMedia,
)
from services import pdf_ingest
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


# ── Response shapes ───────────────────────────────────────────────────────────

class MediaOut(BaseModel):
    id: uuid.UUID
    url: str
    content_type: str
    width: int | None = None
    height: int | None = None
    make: str | None = None
    model: str | None = None
    variant: str | None = None
    colour: str | None = None
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
    return MediaOut(
        id=m.id,
        url=get_storage().url_for(m.storage_key),
        content_type=m.content_type,
        width=m.width,
        height=m.height,
        make=m.make,
        model=m.model,
        variant=m.variant,
        colour=m.colour,
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
    admin: User = Depends(get_admin_user),
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

        return await _ingest_pdf(pdf_path, size, file.filename, admin, db)


async def _ingest_pdf(
    pdf_path: Path,
    size: int,
    filename: str | None,
    admin: User,
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
        uploaded_by=admin.id,
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
            except StorageError as exc:
                logger.warning("Could not store image %s: %s", key, exc)
                storage_failures += 1
                last_storage_error = str(exc)
                continue

            width, height = img.get("width"), img.get("height")
            if not width or not height:
                width, height = pdf_ingest.image_dimensions(img["data"])

            db.add(VehicleMedia(
                storage_key=obj.key,
                content_type=content_type,
                size_bytes=obj.size_bytes,
                width=width,
                height=height,
                source_pdf_name=job.source_pdf_name,
                page_number=img.get("page_number"),
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

    vehicles, engine = await pdf_ingest.extract_vehicles(text)
    for v in vehicles:
        db.add(ExtractedVehicle(job_id=job.id, **v))

    # Attribute images to a vehicle when the brochure covers exactly one, which
    # is the common case for a single-model brochure. With several models the
    # mapping is genuinely ambiguous, so it is left for an admin rather than
    # guessed.
    if len(vehicles) == 1:
        only = vehicles[0]
        for m in (await db.execute(
            select(VehicleMedia).where(VehicleMedia.job_id == job.id)
        )).scalars():
            m.make, m.model, m.variant = only["make"], only["model"], only["variant"]

    job.page_count = pdf_ingest.page_count(pdf_path)
    job.image_count = stored
    job.vehicle_count = len(vehicles)
    job.ai_engine = engine
    job.status = IngestionStatus.completed
    job.completed_at = datetime.now(timezone.utc)

    await db.commit()
    return await _job_detail(db, job.id)


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
    keys = (await db.execute(
        select(VehicleMedia.storage_key).where(VehicleMedia.job_id == job_id)
    )).scalars().all()

    # Files first: a failure here leaves rows pointing at real files, which is
    # recoverable. The reverse leaves orphaned files nothing knows about.
    for key in keys:
        try:
            await storage.delete(key)
        except StorageError as exc:
            logger.warning("Could not delete %s: %s", key, exc)

    await db.delete(job)
    await db.commit()


# ── Public read ───────────────────────────────────────────────────────────────

@router.get("/images", response_model=list[MediaOut])
async def list_images(
    db: AsyncSession = Depends(get_db),
    make: str | None = Query(None),
    model: str | None = Query(None),
    limit: int = Query(60, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """
    Extracted images, newest first. Public: these are catalogue photographs.

    Filtering is case-insensitive because brochure text capitalisation is
    inconsistent ("MARUTI SUZUKI" vs "Maruti Suzuki").
    """
    stmt = select(VehicleMedia)
    if make:
        stmt = stmt.where(VehicleMedia.make.ilike(f"%{make}%"))
    if model:
        stmt = stmt.where(VehicleMedia.model.ilike(f"%{model}%"))
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
