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
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field
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
    ReviewDecision,
    SourceType,
    VerificationStatus,
)
from models.user import User
from services import diagnosis_cache, diagnosis_kb_lookup, diagnosis_kb_review
from services.diagnosis_kb_import import ImportError_, parse_and_import
from services.diagnosis_kb_review import ReviewError

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

    if commit:
        # An import can change what a verified row says. A cached copy of the
        # old text would outlive the correction by up to the cache TTL, and the
        # in-process lookup indexes would keep serving the old aliases, so both
        # are dropped here rather than left to expire.
        await diagnosis_cache.invalidate_all()
        diagnosis_kb_lookup.reset_caches()

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


# ── Review queue ────────────────────────────────────────────────────────────
#
# The importer cannot publish. Everything it writes is DRAFT / PENDING_REVIEW,
# so without these endpoints a knowledge base of any size still answers nobody.
# This is the only path from "in the database" to "served to a driver".


class QueueItem(BaseModel):
    id: str
    diagnosis_code: str
    canonical_symptom: str
    symptom: str
    manufacturer: str
    model: str
    fuel_type: str
    model_year_from: int
    model_year_to: int
    severity: str
    safety_critical: bool
    can_drive: str
    source_type: str
    source_name: str
    confidence_score: float
    status: str
    verification_status: str
    solution_count: int
    created_at: str


class ReviewRequest(BaseModel):
    decision: ReviewDecision
    # Free text, but not optional in practice — see the AI_GENERATED rule in
    # services/diagnosis_kb_review.py, which refuses a silent approval.
    notes: str | None = Field(None, max_length=4000)
    include_solutions: bool = True


@router.get("/review-queue/summary")
async def review_queue_summary(db: DB, admin: Admin) -> dict:
    """How much is waiting, and how much of it needs the most care."""
    counts = await diagnosis_kb_review.queue_counts(db)
    counts["cache"] = diagnosis_cache.stats()
    return counts


@router.get("/review-queue", response_model=list[QueueItem])
async def review_queue(
    db: DB,
    admin: Admin,
    verification_status: VerificationStatus = Query(VerificationStatus.pending_review),
    source_type: SourceType | None = Query(None),
    safety_only: bool = Query(False, description="Only safety-critical findings."),
    search: str | None = Query(None, max_length=120),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Rows waiting on a decision, safety-critical first and oldest first."""
    rows = await diagnosis_kb_review.list_queue(
        db,
        status=verification_status,
        source_type=source_type,
        safety_only=safety_only,
        search=search,
        limit=limit,
        offset=offset,
    )
    if not rows:
        return []

    counts = dict(
        (
            await db.execute(
                select(DiagnosisSolution.diagnosis_id, func.count())
                .where(DiagnosisSolution.diagnosis_id.in_([r.id for r in rows]))
                .group_by(DiagnosisSolution.diagnosis_id)
            )
        ).all()
    )

    return [
        QueueItem(
            id=str(r.id),
            diagnosis_code=r.diagnosis_code,
            canonical_symptom=r.canonical_symptom,
            symptom=r.symptom,
            manufacturer=r.manufacturer,
            model=r.model,
            fuel_type=r.fuel_type,
            model_year_from=r.model_year_from,
            model_year_to=r.model_year_to,
            severity=r.severity.value,
            safety_critical=r.safety_critical,
            can_drive=r.can_drive.value,
            source_type=r.source_type.value,
            source_name=r.source_name,
            confidence_score=r.confidence_score,
            status=r.status.value,
            verification_status=r.verification_status.value,
            solution_count=counts.get(r.id, 0),
            created_at=r.created_at.isoformat(),
        )
        for r in rows
    ]


@router.get("/review-queue/{diagnosis_id}")
async def review_detail(diagnosis_id: uuid.UUID, db: DB, admin: Admin) -> dict:
    """Everything a reviewer needs on one screen: the finding and its repairs.

    Returned in full rather than summarised, because the decision being asked
    for is whether this text is safe to show a driver, and a summary is not
    something you can make that decision about.
    """
    try:
        master, solutions = await diagnosis_kb_review.get_for_review(db, diagnosis_id)
    except ReviewError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    events = await diagnosis_kb_review.history(db, diagnosis_id=diagnosis_id, limit=25)

    return {
        "diagnosis": {
            "id": str(master.id),
            "diagnosis_code": master.diagnosis_code,
            "manufacturer": master.manufacturer,
            "model": master.model,
            "variant": master.variant,
            "engine_code": master.engine_code,
            "model_year_from": master.model_year_from,
            "model_year_to": master.model_year_to,
            "fuel_type": master.fuel_type,
            "odometer_from_km": master.odometer_from_km,
            "odometer_to_km": master.odometer_to_km,
            "system": master.system,
            "subsystem": master.subsystem,
            "error_code": master.error_code,
            "canonical_symptom": master.canonical_symptom,
            "symptom": master.symptom,
            "user_keywords": master.user_keywords,
            "possible_cause": master.possible_cause,
            "diagnostic_steps": master.diagnostic_steps,
            "confirms_when": master.confirms_when,
            "rule_out": master.rule_out,
            "severity": master.severity.value,
            "safety_critical": master.safety_critical,
            "can_drive": master.can_drive.value,
            "recommended_action": master.recommended_action,
            "requires_professional": master.requires_professional,
            "estimated_cost_min": master.estimated_cost_min,
            "estimated_cost_max": master.estimated_cost_max,
            "source_type": master.source_type.value,
            "source_name": master.source_name,
            "source_url": master.source_url,
            "confidence_score": master.confidence_score,
            "status": master.status.value,
            "verification_status": master.verification_status.value,
            "reviewed_by": master.reviewed_by,
            "reviewed_at": master.reviewed_at.isoformat() if master.reviewed_at else None,
            "notes": master.notes,
            "is_servable": master.is_servable,
        },
        "solutions": [
            {
                "id": str(s.id),
                "solution_code": s.solution_code,
                "sequence": s.sequence,
                "solution_title": s.solution_title,
                "solution_type": s.solution_type.value,
                "difficulty": s.difficulty.value,
                "is_temporary_fix": s.is_temporary_fix,
                "resolves_root_cause": s.resolves_root_cause,
                "steps": s.steps,
                "expected_outcome": s.expected_outcome,
                "safety_warning": s.safety_warning,
                "do_not_attempt_if": s.do_not_attempt_if,
                "prerequisites": s.prerequisites,
                "cost_parts_min": s.cost_parts_min,
                "cost_parts_max": s.cost_parts_max,
                "cost_labour_min": s.cost_labour_min,
                "cost_labour_max": s.cost_labour_max,
                "success_rate_pct": s.success_rate_pct,
                "source_type": s.source_type.value,
                "source_name": s.source_name,
                "status": s.status.value,
                "verification_status": s.verification_status.value,
                "is_servable": s.is_servable,
            }
            for s in solutions
        ],
        "review_history": [
            {
                "decision": e.decision.value,
                "reviewer": e.reviewer,
                "notes": e.notes,
                "previous_status": e.previous_status,
                "previous_verification": e.previous_verification,
                "at": e.created_at.isoformat(),
            }
            for e in events
        ],
    }


@router.post("/review/{diagnosis_id}")
@limiter.limit("120/hour")
async def review_one(
    request: Request,
    diagnosis_id: uuid.UUID,
    body: ReviewRequest,
    db: DB,
    admin: Admin,
) -> dict:
    """Approve, reject, or return a diagnosis — and by default its repairs too.

    Approval is the moment a row becomes visible to real drivers, so it is a
    single explicit call per row. There is no bulk-approve endpoint, and that
    omission is the point: the queue exists to be read.
    """
    try:
        outcome = await diagnosis_kb_review.review_diagnosis(
            db,
            diagnosis_id=diagnosis_id,
            decision=body.decision,
            reviewer=admin.email,
            notes=body.notes,
            include_solutions=body.include_solutions,
        )
    except ReviewError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    # What was just published, or withdrawn, changes what the lookup should
    # return. Both in-process indexes and any cached answer are now wrong.
    await diagnosis_cache.invalidate_all()
    diagnosis_kb_lookup.reset_caches()

    return {
        "diagnosis_code": outcome.diagnosis_code,
        "decision": outcome.decision,
        "status": outcome.status,
        "verification_status": outcome.verification_status,
        "solutions_affected": outcome.solutions_affected,
        "reviewer": outcome.reviewer,
        "message": (
            f"{outcome.diagnosis_code} is now servable to drivers."
            if outcome.status == RecordStatus.active.value
            and outcome.verification_status == VerificationStatus.verified.value
            else f"{outcome.diagnosis_code} is {outcome.verification_status} and is not served."
        ),
    }


@router.post("/review/solution/{solution_id}")
@limiter.limit("240/hour")
async def review_solution_endpoint(
    request: Request,
    solution_id: uuid.UUID,
    body: ReviewRequest,
    db: DB,
    admin: Admin,
) -> dict:
    """Decide on a single repair, under a diagnosis that is already approved."""
    try:
        outcome = await diagnosis_kb_review.review_solution(
            db,
            solution_id=solution_id,
            decision=body.decision,
            reviewer=admin.email,
            notes=body.notes,
        )
    except ReviewError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await diagnosis_cache.invalidate_all()
    diagnosis_kb_lookup.reset_caches()
    return {
        "solution_code": outcome.diagnosis_code,
        "decision": outcome.decision,
        "status": outcome.status,
        "verification_status": outcome.verification_status,
    }


@router.get("/review-history")
async def review_history(
    db: DB, admin: Admin, limit: int = Query(100, ge=1, le=500)
) -> list[dict]:
    """Every decision ever made, newest first. Append-only."""
    events = await diagnosis_kb_review.history(db, limit=limit)
    return [
        {
            "decision": e.decision.value,
            "reviewer": e.reviewer,
            "notes": e.notes,
            "diagnosis_id": str(e.diagnosis_id) if e.diagnosis_id else None,
            "solution_id": str(e.solution_id) if e.solution_id else None,
            "previous_status": e.previous_status,
            "previous_verification": e.previous_verification,
            "at": e.created_at.isoformat(),
        }
        for e in events
    ]


# ── Cache administration ────────────────────────────────────────────────────


@router.get("/cache/stats")
async def cache_stats(db: DB, admin: Admin) -> dict:
    """Hit rate and which backend is live.

    `backend: "memory"` in production means REDIS_URL is not reachable and each
    worker is caching separately — answers stay correct, the hit rate does not.
    """
    return diagnosis_cache.stats()


@router.post("/cache/invalidate")
async def cache_invalidate(db: DB, admin: Admin) -> dict:
    """Drop every cached answer. Safe at any time; the next request recomputes."""
    dropped = await diagnosis_cache.invalidate_all()
    diagnosis_kb_lookup.reset_caches()
    return {"dropped_in_process": dropped, "message": "Cache cleared."}
