"""
Challan verification endpoints (BRD §21).

Backs the Track Challan page and, later, the seller listing gate.

WHAT THIS RETURNS TODAY

No authorised source is connected — NIC/Parivahan access is being obtained —
so every verification is recorded and returned as VERIFICATION_PENDING with a
machine-readable reason. It never reports a vehicle as clear. See
services/challan/registry.py for why there is no stub that would.

THE GATE IS BUILT AND OFF BY DEFAULT

BRD §3 requires that no used-car listing be published until verification
passes, and FR-06 requires that be enforced in the backend rather than in the
UI. `listing_publication_allowed` below is that enforcement point.

It is not wired into the publish path in this change, and the reason is
arithmetic rather than caution: with no provider, every vehicle evaluates to
VERIFICATION_PENDING, so switching the gate on today would block every used-car
listing on the platform. CHALLAN_GATE_ENABLED turns it on when a source is
live. The function is written and tested now so that turning it on is a
configuration change rather than a piece of new code written under pressure.
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_optional_user
from core.limiter import limiter
from db.session import get_db
from models.challan import (
    ChallanAuditEvent,
    ChallanDetail,
    ChallanVerificationStatus,
    ListingDecision,
    VehicleChallanVerification,
)
from models.user import User
from services.challan import (
    ProviderUnavailable,
    VerificationRequest,
    active_provider,
    normalise_registration,
)
from services.challan.base import ensure_aware
from services.challan.plate import state_code
from services.challan.rules import evaluate, validity_days

router = APIRouter(prefix="/challan", tags=["challan"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
MaybeUser = Annotated[User | None, Depends(get_optional_user)]

GATE_ENV = "CHALLAN_GATE_ENABLED"


# ── Schemas ───────────────────────────────────────────────────────────────────


class VerifyIn(BaseModel):
    registration_number: str = Field(..., min_length=4, max_length=20)


class ChallanOut(BaseModel):
    challan_number: str | None = None
    challan_date: str | None = None
    amount: float | None = None
    outstanding_amount: float | None = None
    state: str | None = None
    status: str | None = None
    court_status: str | None = None


class VerificationOut(BaseModel):
    id: str
    registration_number: str
    verification_status: str
    risk_category: str
    listing_decision: str
    total_challan_count: int
    outstanding_challan_count: int
    total_outstanding_amount: float
    #: Always present on a completed check. The buyer-facing claim is "checked
    #: on this date", never "clean" — BRD §16.
    verified_at: str | None = None
    verification_expiry_at: str | None = None
    decision_reason: str | None = None
    #: Set only when the check could not be completed, so the client can tell
    #: an outage from a result.
    unavailable_reason: str | None = None
    challans: list[ChallanOut] = []


# ── Helpers ───────────────────────────────────────────────────────────────────


def _out(v: VehicleChallanVerification, details: list[ChallanDetail]) -> VerificationOut:
    return VerificationOut(
        id=str(v.id),
        registration_number=v.registration_number,
        verification_status=v.verification_status.value,
        risk_category=v.risk_category.value,
        listing_decision=v.listing_decision.value,
        total_challan_count=v.total_challan_count,
        outstanding_challan_count=v.outstanding_challan_count,
        total_outstanding_amount=float(v.total_outstanding_amount or 0),
        verified_at=v.verified_at.isoformat() if v.verified_at else None,
        verification_expiry_at=(
            v.verification_expiry_at.isoformat() if v.verification_expiry_at else None
        ),
        decision_reason=v.decision_reason,
        challans=[
            ChallanOut(
                challan_number=d.challan_number,
                challan_date=d.challan_date.isoformat() if d.challan_date else None,
                amount=float(d.amount) if d.amount is not None else None,
                outstanding_amount=(
                    float(d.outstanding_amount) if d.outstanding_amount is not None else None
                ),
                state=d.state,
                status=d.challan_status,
                court_status=d.court_status,
            )
            for d in details
        ],
    )


async def listing_publication_allowed(
    db: AsyncSession, registration_number: str
) -> tuple[bool, str]:
    """Backend enforcement of BRD §3 / FR-06 / AC-08 / AC-09.

    Returns (allowed, reason). Off unless CHALLAN_GATE_ENABLED is set — see the
    module docstring for why it cannot be on before a provider exists.

    AC-09 is handled here rather than at verification time: a PASS that has
    aged past its validity window stops being a PASS, and the check has to
    happen when publication is attempted, not when the row was written.
    """
    if os.getenv(GATE_ENV, "").lower() not in {"1", "true", "yes"}:
        return True, "Challan gating is disabled."

    reg = normalise_registration(registration_number)
    if reg is None:
        return False, "A valid vehicle registration number is required."

    latest = (
        await db.execute(
            select(VehicleChallanVerification)
            .where(VehicleChallanVerification.registration_number == reg)
            .order_by(VehicleChallanVerification.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    if latest is None:
        return False, "This vehicle has not been checked for challans yet."
    if latest.listing_decision is not ListingDecision.verified:
        return False, latest.decision_reason or "Challan verification has not passed."
    expiry = ensure_aware(latest.verification_expiry_at)
    if expiry and expiry < datetime.now(timezone.utc):
        return False, "The challan verification for this vehicle has expired."
    return True, "Challan verification is current and passed."


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/verify", response_model=VerificationOut)
@limiter.limit("10/minute")
async def verify(
    request: Request,
    body: VerifyIn,
    db: DbDep,
    current_user: MaybeUser = None,
):
    """Check a vehicle's challan status through the authorised source.

    Records the attempt whether or not it succeeded. A failed lookup is data:
    it is what a re-verification cooldown counts, and a run of them against one
    provider is how an outage becomes visible instead of looking like an
    absence of sellers.
    """
    reg = normalise_registration(body.registration_number)
    if reg is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Please enter a valid vehicle registration number.",
        )

    verification = VehicleChallanVerification(
        listing_id=None,
        seller_id=current_user.id if current_user else None,
        registration_number=reg,
        requested_at=datetime.now(timezone.utc),
    )
    db.add(verification)
    await db.flush()

    db.add(
        ChallanAuditEvent(
            verification_id=verification.id,
            actor_id=current_user.id if current_user else None,
            event="verification_requested",
            detail={"registration_number": reg},
        )
    )

    try:
        provider = active_provider()
        result = await provider.fetch(
            VerificationRequest(registration_number=reg, state_code=state_code(reg))
        )
    except ProviderUnavailable as exc:
        outcome = await evaluate(db, None, failure_reason=str(exc))
        verification.verification_status = ChallanVerificationStatus.failed
        verification.risk_category = outcome.risk
        verification.listing_decision = outcome.decision
        verification.failure_reason = str(exc)
        verification.decision_reason = outcome.reason
        verification.responded_at = datetime.now(timezone.utc)
        await db.commit()

        out = _out(verification, [])
        out.unavailable_reason = exc.reason
        return out

    # A source answered.
    verification.provider = result.provider
    verification.provider_reference_id = result.provider_reference_id
    verification.responded_at = datetime.now(timezone.utc)
    verification.verification_status = (
        ChallanVerificationStatus.completed
        if result.found_records
        else ChallanVerificationStatus.no_record_found
    )
    verification.total_challan_count = len(result.records)
    verification.outstanding_challan_count = result.outstanding_count
    verification.total_outstanding_amount = result.outstanding_total

    details = [
        ChallanDetail(
            verification_id=verification.id,
            challan_number=r.challan_number,
            challan_date=r.challan_date,
            amount=r.amount,
            outstanding_amount=r.outstanding_amount,
            state=r.state,
            department=r.department,
            challan_status=r.status,
            court_status=r.court_status,
            is_court_case=r.is_court_case,
        )
        for r in result.records
    ]
    for d in details:
        db.add(d)

    outcome = await evaluate(db, result)
    verification.risk_category = outcome.risk
    verification.listing_decision = outcome.decision
    verification.decision_reason = outcome.reason
    verification.verified_at = datetime.now(timezone.utc)
    verification.verification_expiry_at = verification.verified_at + timedelta(
        days=await validity_days(db)
    )

    await db.flush()
    return _out(verification, details)


@router.get("/latest/{registration_number}", response_model=VerificationOut)
@limiter.limit("30/minute")
async def latest(request: Request, registration_number: str, db: DbDep):
    """The most recent check for a vehicle, if there is one."""
    reg = normalise_registration(registration_number)
    if reg is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Please enter a valid vehicle registration number.",
        )

    v = (
        await db.execute(
            select(VehicleChallanVerification)
            .where(VehicleChallanVerification.registration_number == reg)
            .order_by(VehicleChallanVerification.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if v is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This vehicle has not been checked yet.",
        )

    details = (
        await db.execute(select(ChallanDetail).where(ChallanDetail.verification_id == v.id))
    ).scalars().all()
    return _out(v, list(details))
