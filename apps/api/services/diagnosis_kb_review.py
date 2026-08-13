"""The review queue: turning drafts into rows a driver is allowed to see.

WHY THIS EXISTS AT ALL

The importer deliberately cannot publish. Everything it writes lands as
DRAFT / PENDING_REVIEW, so a knowledge base with ten thousand imported rows
still answers nobody until a person has looked at them. That is the design, and
it means the corpus is inert without this module — approval is the only path
from "in the database" to "served".

WHAT APPROVAL ACTUALLY DOES

Sets both gates, records who set them, and writes an append-only event. Both
gates together, because `status` and `verification_status` answer different
questions — "is this current?" and "has anyone checked it?" — and a row that is
merely un-archived must not become servable by that alone.

A SOLUTION CANNOT OUTRANK ITS DIAGNOSIS

Approving solutions under a diagnosis that is itself unapproved would produce
repairs attached to a finding nobody has verified. The check is explicit here
rather than left to the lookup query, so the invalid state never exists in the
table in the first place.

REJECTION DOES NOT DELETE

A rejected row keeps its content and gains a reason. Deleting it would destroy
the evidence of what was proposed, and would let the same bad row be re-imported
next week with nothing to say it had already been refused.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.diagnosis_kb import (
    DiagnosisMaster,
    DiagnosisReviewEvent,
    DiagnosisSolution,
    RecordStatus,
    ReviewDecision,
    SourceType,
    VerificationStatus,
)

logger = logging.getLogger("gaadiiq.kb_review")


class ReviewError(RuntimeError):
    """A decision that must not be applied — with the reason for the admin."""


@dataclass
class ReviewOutcome:
    diagnosis_code: str
    decision: str
    status: str
    verification_status: str
    solutions_affected: int
    reviewer: str


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── reading the queue ───────────────────────────────────────────────────────

async def queue_counts(db: AsyncSession) -> dict:
    """How much is waiting, split by where it came from.

    AI-generated rows are counted separately because they are the ones that
    must never be bulk-approved, and a queue that does not distinguish them
    invites exactly that.
    """
    async def count(stmt) -> int:
        return int((await db.execute(stmt)).scalar_one() or 0)

    pending = DiagnosisMaster.verification_status == VerificationStatus.pending_review

    return {
        "pending_diagnoses": await count(
            select(func.count()).select_from(DiagnosisMaster).where(pending)
        ),
        "pending_ai_generated": await count(
            select(func.count()).select_from(DiagnosisMaster).where(
                pending, DiagnosisMaster.source_type == SourceType.ai_generated
            )
        ),
        "pending_safety_critical": await count(
            select(func.count()).select_from(DiagnosisMaster).where(
                pending, DiagnosisMaster.safety_critical.is_(True)
            )
        ),
        "pending_solutions": await count(
            select(func.count()).select_from(DiagnosisSolution).where(
                DiagnosisSolution.verification_status == VerificationStatus.pending_review
            )
        ),
        "rejected_diagnoses": await count(
            select(func.count()).select_from(DiagnosisMaster).where(
                DiagnosisMaster.verification_status == VerificationStatus.rejected
            )
        ),
    }


async def list_queue(
    db: AsyncSession,
    *,
    status: VerificationStatus = VerificationStatus.pending_review,
    source_type: SourceType | None = None,
    safety_only: bool = False,
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[DiagnosisMaster]:
    """The queue itself.

    Ordered safety-critical first, then oldest first. A reviewer working top-down
    therefore clears the rows that matter most, and within those the ones that
    have been waiting longest — rather than whichever happened to be imported
    last, which is what a plain `created_at DESC` would give them.
    """
    stmt = select(DiagnosisMaster).where(DiagnosisMaster.verification_status == status)

    if source_type is not None:
        stmt = stmt.where(DiagnosisMaster.source_type == source_type)
    if safety_only:
        stmt = stmt.where(DiagnosisMaster.safety_critical.is_(True))
    if search:
        pattern = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(DiagnosisMaster.diagnosis_code).like(pattern),
                func.lower(DiagnosisMaster.symptom).like(pattern),
                func.lower(DiagnosisMaster.canonical_symptom).like(pattern),
            )
        )

    stmt = stmt.order_by(
        DiagnosisMaster.safety_critical.desc(),
        DiagnosisMaster.created_at.asc(),
    ).limit(limit).offset(offset)

    return list((await db.execute(stmt)).scalars().all())


async def get_for_review(
    db: AsyncSession, diagnosis_id: uuid.UUID
) -> tuple[DiagnosisMaster, list[DiagnosisSolution]]:
    """One row with everything a reviewer needs to decide, solutions included."""
    master = (
        await db.execute(select(DiagnosisMaster).where(DiagnosisMaster.id == diagnosis_id))
    ).scalar_one_or_none()
    if master is None:
        raise ReviewError("No diagnosis with that id.")

    solutions = list(
        (
            await db.execute(
                select(DiagnosisSolution)
                .where(DiagnosisSolution.diagnosis_id == diagnosis_id)
                .order_by(DiagnosisSolution.sequence)
            )
        ).scalars().all()
    )
    return master, solutions


async def history(
    db: AsyncSession, *, diagnosis_id: uuid.UUID | None = None, limit: int = 100
) -> list[DiagnosisReviewEvent]:
    stmt = select(DiagnosisReviewEvent).order_by(DiagnosisReviewEvent.created_at.desc())
    if diagnosis_id is not None:
        stmt = stmt.where(DiagnosisReviewEvent.diagnosis_id == diagnosis_id)
    return list((await db.execute(stmt.limit(limit))).scalars().all())


# ── deciding ────────────────────────────────────────────────────────────────

async def review_diagnosis(
    db: AsyncSession,
    *,
    diagnosis_id: uuid.UUID,
    decision: ReviewDecision,
    reviewer: str,
    notes: str | None = None,
    include_solutions: bool = True,
) -> ReviewOutcome:
    """Apply a decision to a diagnosis, and optionally to its solutions.

    `include_solutions` defaults to True because the common case is a reviewer
    reading the whole entry — finding, causes and repairs — and approving what
    they read. Approving the finding alone would leave a servable diagnosis with
    no servable repairs, which renders as a diagnosis with an empty fix list.
    """
    master, solutions = await get_for_review(db, diagnosis_id)

    previous_status = master.status.value if master.status else None
    previous_verification = (
        master.verification_status.value if master.verification_status else None
    )

    if decision is ReviewDecision.approved:
        _refuse_unreviewable(master, notes)
        master.status = RecordStatus.active
        master.verification_status = VerificationStatus.verified
        master.last_verified = date.today()
    elif decision is ReviewDecision.rejected:
        master.verification_status = VerificationStatus.rejected
        # Deliberately INACTIVE rather than DRAFT: a rejected row must not look
        # like something still being worked on.
        master.status = RecordStatus.inactive
    else:  # returned
        master.verification_status = VerificationStatus.pending_review
        master.status = RecordStatus.draft

    master.reviewed_by = reviewer
    master.reviewed_at = _now()
    if notes:
        master.notes = notes

    affected = 0
    if include_solutions:
        for sol in solutions:
            if decision is ReviewDecision.approved:
                sol.status = RecordStatus.active
                sol.verification_status = VerificationStatus.verified
            elif decision is ReviewDecision.rejected:
                sol.status = RecordStatus.inactive
                sol.verification_status = VerificationStatus.rejected
            else:
                sol.status = RecordStatus.draft
                sol.verification_status = VerificationStatus.pending_review
            sol.reviewed_by = reviewer
            sol.reviewed_at = _now()
            affected += 1

    db.add(
        DiagnosisReviewEvent(
            diagnosis_id=master.id,
            decision=decision,
            reviewer=reviewer,
            notes=notes,
            previous_status=previous_status,
            previous_verification=previous_verification,
        )
    )
    await db.commit()
    await db.refresh(master)

    logger.info(
        "kb_review",
        extra={
            "event": "kb_review",
            "diagnosis_code": master.diagnosis_code,
            "decision": decision.value,
            "reviewer": reviewer,
            "safety_critical": master.safety_critical,
            "solutions_affected": affected,
        },
    )

    return ReviewOutcome(
        diagnosis_code=master.diagnosis_code,
        decision=decision.value,
        status=master.status.value,
        verification_status=master.verification_status.value,
        solutions_affected=affected,
        reviewer=reviewer,
    )


async def review_solution(
    db: AsyncSession,
    *,
    solution_id: uuid.UUID,
    decision: ReviewDecision,
    reviewer: str,
    notes: str | None = None,
) -> ReviewOutcome:
    """Approve or refuse a single repair under an already-approved diagnosis."""
    sol = (
        await db.execute(select(DiagnosisSolution).where(DiagnosisSolution.id == solution_id))
    ).scalar_one_or_none()
    if sol is None:
        raise ReviewError("No solution with that id.")

    master = (
        await db.execute(
            select(DiagnosisMaster).where(DiagnosisMaster.id == sol.diagnosis_id)
        )
    ).scalar_one_or_none()
    if master is None:
        raise ReviewError("This solution has no diagnosis — it should not exist.")

    if decision is ReviewDecision.approved and not master.is_servable:
        raise ReviewError(
            f"Approve the diagnosis {master.diagnosis_code} first. A repair cannot be "
            f"served under a finding nobody has verified."
        )

    previous_status = sol.status.value if sol.status else None
    previous_verification = sol.verification_status.value if sol.verification_status else None

    if decision is ReviewDecision.approved:
        sol.status = RecordStatus.active
        sol.verification_status = VerificationStatus.verified
    elif decision is ReviewDecision.rejected:
        sol.status = RecordStatus.inactive
        sol.verification_status = VerificationStatus.rejected
    else:
        sol.status = RecordStatus.draft
        sol.verification_status = VerificationStatus.pending_review

    sol.reviewed_by = reviewer
    sol.reviewed_at = _now()
    if notes:
        sol.notes = notes

    db.add(
        DiagnosisReviewEvent(
            solution_id=sol.id,
            diagnosis_id=master.id,
            decision=decision,
            reviewer=reviewer,
            notes=notes,
            previous_status=previous_status,
            previous_verification=previous_verification,
        )
    )
    await db.commit()

    return ReviewOutcome(
        diagnosis_code=sol.solution_code,
        decision=decision.value,
        status=sol.status.value,
        verification_status=sol.verification_status.value,
        solutions_affected=1,
        reviewer=reviewer,
    )


def _refuse_unreviewable(master: DiagnosisMaster, notes: str | None) -> None:
    """Two approvals this module will not perform.

    Both are cases where clicking approve is easy and being wrong is expensive,
    so the cost of the extra step falls on the reviewer rather than on a driver.
    """
    missing = [
        name
        for name, value in (
            ("symptom", master.symptom),
            ("possible_cause", master.possible_cause),
            ("recommended_action", master.recommended_action),
        )
        if not (value or "").strip()
    ]
    if missing:
        raise ReviewError(
            "Cannot approve a row with empty " + ", ".join(missing) +
            ". A verified row is presented to drivers as fact and has to say something."
        )

    # An AI-generated row is exactly the kind that reads convincingly and cites
    # nothing. Approving one is allowed — a reviewer may well have checked it
    # against a manual — but not silently.
    if master.source_type == SourceType.ai_generated and not (notes or "").strip():
        raise ReviewError(
            "This row is AI_GENERATED. Approving it requires a note saying what it was "
            "checked against — the text alone is not evidence that it is right."
        )
