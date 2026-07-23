"""FastAPI app: PDF ingestion pipeline REST API."""

from __future__ import annotations
import asyncio
import logging
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from models import (
    ApproveRequest,
    ExtractionStatus,
    IngestionJob,
    PatchRequest,
    RejectRequest,
    VehicleStatus,
)
from pdf_parser import PdfParser
from ai_extractor import extract_vehicles
from image_matcher import match_images
from validator import detect_duplicates, flag_conflicts

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="GAADIIQ PDF Ingestion API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("/tmp/gaadiiq-pdf-uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

IMAGES_DIR = Path("/tmp/gaadiiq-pdf-images")
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

# In-memory job store (replace with DB in production)
_jobs: dict[str, IngestionJob] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_job(job_id: str) -> IngestionJob:
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _get_vehicle(job: IngestionJob, vehicle_id: str):
    v = next((v for v in job.vehicles if v.id == vehicle_id), None)
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return v


# ── Background pipeline ───────────────────────────────────────────────────────

def _run_pipeline(job_id: str, pdf_path: Path) -> None:
    """Synchronous pipeline; called via asyncio.to_thread."""
    job = _jobs[job_id]
    parser = PdfParser()

    try:
        # Stage 1: Parse
        job.status = ExtractionStatus.PARSING
        job.progress = 10
        doc = parser.parse(pdf_path)
        logger.info(f"[{job_id}] Parsed {len(doc.pages)} pages, {len(doc.all_images)} images")

        # Stage 2: AI extraction
        job.status = ExtractionStatus.EXTRACTING
        job.progress = 35
        pages_text = {p.page_num: p.text for p in doc.pages}
        vehicles = extract_vehicles(doc, job_id)
        logger.info(f"[{job_id}] Extracted {len(vehicles)} vehicles")

        # Stage 3: Image matching
        job.status = ExtractionStatus.MATCHING_IMAGES
        job.progress = 60
        vehicles = match_images(doc.all_images, vehicles, pages_text, job_id)

        # Stage 4: Validation / duplicate check
        job.status = ExtractionStatus.VALIDATING
        job.progress = 80
        vehicles = detect_duplicates(vehicles, [], threshold=0.85)
        vehicles = flag_conflicts(vehicles)

        # Done
        job.vehicles = vehicles
        job.vehicles_found = len(vehicles)
        job.status = ExtractionStatus.AWAITING_REVIEW
        job.progress = 100
        job.completed_at = _now()
        logger.info(f"[{job_id}] Pipeline complete — {len(vehicles)} vehicles awaiting review")

    except Exception as e:
        logger.error(f"[{job_id}] Pipeline failed: {e}", exc_info=True)
        job.status = ExtractionStatus.FAILED
        job.error = str(e)
        job.completed_at = _now()
    finally:
        try:
            pdf_path.unlink(missing_ok=True)
        except Exception:
            pass


async def _run_pipeline_async(job_id: str, pdf_path: Path) -> None:
    await asyncio.to_thread(_run_pipeline, job_id, pdf_path)


# ── Upload ────────────────────────────────────────────────────────────────────

MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024  # 10 GB
CHUNK_SIZE       = 4 * 1024 * 1024           # 4 MB read buffer


@app.post("/api/pdf-ingestion/upload")
async def upload_pdf(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    listing_type: str = Form("new"),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    if listing_type not in ("new", "used"):
        listing_type = "new"

    job_id = str(uuid.uuid4())
    ext = Path(file.filename).suffix or ".bin"
    upload_path = UPLOAD_DIR / f"{job_id}{ext}"

    # Stream to disk in chunks — avoids loading large files into RAM
    file_size = 0
    try:
        with upload_path.open("wb") as out:
            while True:
                chunk = await file.read(CHUNK_SIZE)
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > MAX_UPLOAD_BYTES:
                    out.close()
                    upload_path.unlink(missing_ok=True)
                    raise HTTPException(status_code=413, detail="File too large (max 10 GB)")
                out.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        upload_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")

    job = IngestionJob(
        id=job_id,
        filename=file.filename,
        file_size=file_size,
        created_at=_now(),
        listing_type=listing_type,
    )
    _jobs[job_id] = job

    background_tasks.add_task(_run_pipeline_async, job_id, upload_path)

    logger.info(f"Queued job {job_id} for {file.filename} ({file_size // 1024} KB) [{listing_type}]")
    return job


# ── Jobs ──────────────────────────────────────────────────────────────────────

@app.get("/api/pdf-ingestion/jobs")
def list_jobs():
    return list(_jobs.values())


@app.get("/api/pdf-ingestion/jobs/{job_id}")
def get_job(job_id: str):
    return _get_job(job_id)


# ── Vehicle actions ───────────────────────────────────────────────────────────

@app.post("/api/pdf-ingestion/jobs/{job_id}/vehicles/{vehicle_id}/approve")
def approve_vehicle(job_id: str, vehicle_id: str, body: Optional[ApproveRequest] = None):
    job = _get_job(job_id)
    v = _get_vehicle(job, vehicle_id)

    if body:
        for field, val in body.model_dump(exclude_none=True).items():
            setattr(v, field, val)

    v.status = VehicleStatus.READY
    return {"ok": True, "vehicle_id": vehicle_id, "status": v.status}


@app.post("/api/pdf-ingestion/jobs/{job_id}/vehicles/{vehicle_id}/reject")
def reject_vehicle(job_id: str, vehicle_id: str, body: Optional[RejectRequest] = None):
    job = _get_job(job_id)
    v = _get_vehicle(job, vehicle_id)
    v.status = VehicleStatus.INCOMPLETE
    if body and body.reason:
        v.admin_notes = (v.admin_notes + " " + body.reason).strip()
    return {"ok": True, "vehicle_id": vehicle_id, "status": v.status}


@app.patch("/api/pdf-ingestion/jobs/{job_id}/vehicles/{vehicle_id}")
def patch_vehicle(job_id: str, vehicle_id: str, body: PatchRequest):
    job = _get_job(job_id)
    v = _get_vehicle(job, vehicle_id)
    for field, val in body.model_dump(exclude_none=True).items():
        setattr(v, field, val)
    return v


@app.post("/api/pdf-ingestion/jobs/{job_id}/bulk-approve")
def bulk_approve(job_id: str):
    job = _get_job(job_id)
    count = 0
    for v in job.vehicles:
        if v.quality_score >= 75 and v.status != VehicleStatus.INCOMPLETE:
            v.status = VehicleStatus.READY
            count += 1
    return {"ok": True, "approved": count}


@app.post("/api/pdf-ingestion/jobs/{job_id}/vehicles/{vehicle_id}/assign-image/{image_id}")
def assign_image(job_id: str, vehicle_id: str, image_id: str):
    job = _get_job(job_id)
    target = _get_vehicle(job, vehicle_id)

    # Find the image across all vehicles in job
    found_img = None
    for v in job.vehicles:
        for img in v.images:
            if img.id == image_id:
                found_img = img
                v.images.remove(img)
                break
        if found_img:
            break

    if not found_img:
        raise HTTPException(status_code=404, detail="Image not found")

    found_img.matched_variant = f"{target.make} {target.model} {target.variant}".strip()
    found_img.match_confidence = 1.0
    target.images.append(found_img)
    return {"ok": True}


# ── Static image serving ──────────────────────────────────────────────────────

@app.get("/tmp-images/{job_id}/{filename}")
def serve_image(job_id: str, filename: str):
    img_path = IMAGES_DIR / job_id / filename
    if not img_path.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(str(img_path))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, reload=True)
