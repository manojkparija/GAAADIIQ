"""Admin API for the diagnosis knowledge base.

Every route here is admin-only. The knowledge base decides what drivers are
told about their brakes, so write access to it is not something a signed-in
user should have.

Preview before commit is deliberate and is the reason `dry_run` defaults to
True on the shared service: an editor uploading four hundred rows should see
what will change before it changes.

NOTE: no `from __future__ import annotations` here. PEP 563 turns annotations
into strings, which breaks FastAPI's signature introspection behind the
@limiter decorator — the UploadFile and the DB dependency get read as query
parameters and every request 422s. Same reason as routers/otp.py.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_admin_user
from core.limiter import limiter
from db.session import get_db
from models.diagnosis_kb import (
    DiagnosisImportRun,
    DiagnosisMaster,
    DiagnosisSolution,
    DiagnosisSymptomAlias,
    RecordStatus,
    VerificationStatus,
)
from models.user import User
from services.diagnosis_kb_import import ImportError_, parse_and_import

logger = logging.getLogger("gaadiiq.kb_admin")

router = APIRouter(prefix="/admin/diagnosis-kb", tags=["admin", "diagnosis-kb"])

DB = Annotated[AsyncSession, Depends(get_db)]
Admin = Annotated[User, Depends(get_admin_user)]

# Large enough for a serious import, small enough that a wrong file does not
# become a memory event. ~40k rows of this shape fit comfortably inside it.
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


class KbStats(BaseModel):
    """Counts that answer 'is this knowledge base actually usable yet'."""

    master_total: int
    master_servable: int
    solutions_total: int
    solutions_servable: int
    aliases_total: int
    canonical_symptoms: int
    safety_critical: int
    # The number that matters: a corpus of drafts answers nobody.
    servable_share: float


@router.get("/stats", response_model=KbStats)
async def kb_stats(db: DB, admin: Admin) -> KbStats:
    """Size and readiness of the knowledge base."""
    async def count(stmt) -> int:
        return int((await db.execute(stmt)).scalar_one() or 0)

    servable = (
        (DiagnosisMaster.status == RecordStatus.active)
        & (DiagnosisMaster.verification_status == VerificationStatus.verified)
    )
    sol_servable = (
        (DiagnosisSolution.status == RecordStatus.active)
        & (DiagnosisSolution.verification_status == VerificationStatus.verified)
    )

    master_total = await count(select(func.count()).select_from(DiagnosisMaster))
    master_servable = await count(
        select(func.count()).select_from(DiagnosisMaster).where(servable)
    )
    return KbStats(
        master_total=master_total,
        master_servable=master_servable,
        solutions_total=await count(select(func.count()).select_from(DiagnosisSolution)),
        solutions_servable=await count(
            select(func.count()).select_from(DiagnosisSolution).where(sol_servable)
        ),
        aliases_total=await count(select(func.count()).select_from(DiagnosisSymptomAlias)),
        canonical_symptoms=await count(
            select(func.count(func.distinct(DiagnosisMaster.canonical_symptom)))
        ),
        safety_critical=await count(
            select(func.count()).select_from(DiagnosisMaster)
            .where(DiagnosisMaster.safety_critical.is_(True))
        ),
        servable_share=round(master_servable / master_total, 3) if master_total else 0.0,
    )


@router.post("/import", status_code=status.HTTP_200_OK)
@limiter.limit("20/hour")
async def import_workbook(
    request: Request,
    db: DB,
    admin: Admin,
    file: UploadFile = File(...),
    commit: bool = Query(
        False,
        description="False (default) validates and reports without writing. "
                    "True writes the rows that pass.",
    ),
):
    """Validate a knowledge-base workbook, and optionally import it.

    Defaults to a dry run. Committing is an explicit act, because the failure
    mode of the opposite default — an editor uploading the wrong file and
    finding out afterwards — is a corrupted corpus that answers real drivers.
    """
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File is {len(content) // 1024 // 1024} MB; the limit is "
                   f"{MAX_UPLOAD_BYTES // 1024 // 1024} MB.",
        )
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The file is empty.")

    try:
        result = await parse_and_import(
            db,
            content=content,
            filename=file.filename or "upload.xlsx",
            imported_by=admin.email,
            dry_run=not commit,
        )
    except ImportError_ as exc:
        # The workbook could not be read at all — a wrong file type, a corrupt
        # upload, a missing sheet. Distinct from row-level errors, which come
        # back with a 200 and a report.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    payload = result.as_dict()
    payload["committed"] = bool(commit)
    payload["message"] = (
        f"Imported {result.master_created} new and {result.master_updated} updated diagnoses, "
        f"{result.solution_created + result.solution_updated} solutions."
        if commit
        else f"Preview only — nothing written. {result.master_created} would be created, "
             f"{result.master_updated} updated, {result.master_rejected} rejected."
    )
    return payload


class ImportRunOut(BaseModel):
    id: str
    filename: str
    imported_by: str
    dry_run: bool
    master_created: int
    master_updated: int
    master_rejected: int
    solution_created: int
    solution_updated: int
    solution_rejected: int
    alias_created: int
    error_count: int
    created_at: str


@router.get("/import-history", response_model=list[ImportRunOut])
async def import_history(db: DB, admin: Admin, limit: int = Query(50, ge=1, le=200)):
    """Every import attempt, newest first — including the ones that failed.

    A rejected import is the more useful record: it says what an editor tried to
    add and why it was refused.
    """
    runs = (
        await db.execute(
            select(DiagnosisImportRun)
            .order_by(DiagnosisImportRun.created_at.desc())
            .limit(limit)
        )
    ).scalars().all()

    return [
        ImportRunOut(
            id=str(r.id),
            filename=r.filename,
            imported_by=r.imported_by,
            dry_run=r.dry_run,
            master_created=r.master_created,
            master_updated=r.master_updated,
            master_rejected=r.master_rejected,
            solution_created=r.solution_created,
            solution_updated=r.solution_updated,
            solution_rejected=r.solution_rejected,
            alias_created=r.alias_created,
            error_count=len((r.errors or "").splitlines()),
            created_at=r.created_at.isoformat(),
        )
        for r in runs
    ]
