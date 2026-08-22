"""
New-car leads — capture from the buyer, deliver to a dealer.

POST /leads          — create a lead; verifies the OTP itself (public)
GET  /leads          — the caller's city inbox; admins see everything
PATCH /leads/{id}    — move a lead along the pipeline

WHY THE OTP IS CHECKED HERE AND NOT BEFORE
==========================================

/auth/otp/verify returns {"verified": true} and no token. Nothing carries that
verification forward, so a two-call flow — verify, then post the lead — would
let any client post any phone number and assert it had been checked. Dealers
would then ring numbers whose owners never asked to be called, which is the
one outcome this whole feature must not produce.

So the lead endpoint takes the code and calls otp_store.verify itself. A
correct code is consumed there, so it cannot be replayed into a second lead,
and the store's five-attempt cap applies unchanged. The cost is that the client
must not call /auth/otp/verify first: doing so consumes the code and this then
fails. The web client is written accordingly.
"""
# NOTE: deliberately NOT using `from __future__ import annotations` — see
# routers/otp.py. PEP 563 stringifies annotations and slowapi's wrapper then
# leaves FastAPI reading the body as query params.

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_user
from core.limiter import limiter
from db.session import get_db
from models.car import Car
from models.car_lead import CarLead, LeadSource, LeadStatus
from models.dealer import Dealer
from models.user import User, UserRole
from services import otp_store

router = APIRouter(prefix="/leads", tags=["leads"])


class LeadCreate(BaseModel):
    # Same pattern as the OTP router, so a number that could never have been
    # sent a code cannot be submitted here either.
    phone: str = Field(..., pattern=r"^\+91[6-9]\d{9}$")
    otp: str = Field(..., min_length=6, max_length=6)

    city: str = Field(..., min_length=1, max_length=100)
    locality: str | None = Field(None, max_length=160)
    pincode: str | None = Field(None, pattern=r"^\d{6}$")

    car_id: uuid.UUID | None = None
    make: str = Field(..., min_length=1, max_length=80)
    model: str = Field(..., min_length=1, max_length=120)
    variant: str | None = Field(None, max_length=120)

    name: str | None = Field(None, max_length=160)
    email: EmailStr | None = None
    source: LeadSource = LeadSource.offers_cta

    # The buyer ticking the consent line. Required to be true: a dealer calling
    # someone who did not agree to be called is the harm here, and a default of
    # false that the client can simply omit is not a consent record.
    consent: bool = Field(..., description="Buyer agreed to be contacted by a dealer")


class LeadOut(BaseModel):
    id: uuid.UUID
    make: str
    model: str
    variant: str | None
    city: str
    locality: str | None
    pincode: str | None
    phone: str
    phone_verified: bool
    name: str | None
    email: str | None
    consented_at: datetime | None
    source: LeadSource
    status: LeadStatus
    created_at: datetime

    model_config = {"from_attributes": True}


class LeadAck(BaseModel):
    """What the buyer gets back.

    Deliberately not a LeadOut: the buyer does not need their own row echoed,
    and returning it would put a lead id in the page for anybody watching.
    """

    received: bool
    city: str
    dealers_in_city: int


@router.post("", response_model=LeadAck, status_code=status.HTTP_201_CREATED)
@limiter.limit("10/hour")
async def create_lead(
    request: Request, body: LeadCreate, db: AsyncSession = Depends(get_db)
):
    """Record a verified enquiry for dealer follow-up."""
    if not body.consent:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "A lead cannot be recorded without the buyer's consent to be contacted.",
        )

    try:
        ok = await otp_store.verify(body.phone, body.otp)
    except otp_store.OtpNotFound:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "OTP not found or expired — request a new one"
        ) from None
    except otp_store.OtpAttemptsExhausted:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Too many incorrect attempts — request a new OTP",
        ) from None

    if not ok:
        remaining = await otp_store.attempts_remaining(body.phone)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, f"Invalid OTP. {remaining} attempt(s) remaining."
        )

    # The car is looked up rather than trusted: make and model are stored on the
    # lead and are what a dealer is called about, so a client must not be able
    # to attach a real car_id to an unrelated model.
    make, model = body.make, body.model
    if body.car_id is not None:
        car = (
            await db.execute(select(Car).where(Car.id == body.car_id))
        ).scalar_one_or_none()
        if car is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Car not found")
        make, model = car.make, car.model

    lead = CarLead(
        car_id=body.car_id,
        make=make,
        model=model,
        variant=body.variant,
        city=body.city.strip(),
        locality=body.locality,
        pincode=body.pincode,
        phone=body.phone,
        phone_verified=True,           # only ever set on this path
        name=body.name,
        email=body.email,
        consented_at=datetime.now(timezone.utc),
        source=body.source,
        status=LeadStatus.new,
    )
    db.add(lead)
    await db.commit()

    # Told to the buyer so the promise on screen is accurate. If no dealer
    # covers their city, the page says so rather than "a dealer will call".
    dealers = (
        await db.execute(
            select(Dealer).where(Dealer.city.ilike(body.city.strip()), Dealer.is_verified.is_(True))
        )
    ).scalars().all()

    return LeadAck(received=True, city=lead.city, dealers_in_city=len(dealers))


@router.get("", response_model=list[LeadOut])
async def list_leads(
    status_filter: LeadStatus | None = Query(None, alias="status"),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Leads for the calling dealer's city; everything for an admin.

    Scoped in the query rather than filtered after loading: a lead carries a
    phone number, and "fetch them all and drop the ones you should not see" is
    the shape of mistake that leaks one.
    """
    q = select(CarLead).order_by(CarLead.created_at.desc()).limit(limit)

    if user.role != UserRole.admin:
        dealer = (
            await db.execute(select(Dealer).where(Dealer.user_id == user.id))
        ).scalar_one_or_none()
        if dealer is None:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Only dealers and admins can read leads."
            )
        if not dealer.city:
            # No city means no routing rule, and the alternative — showing all
            # leads — would hand every buyer's number to an unplaced dealer.
            return []
        q = q.where(CarLead.city.ilike(dealer.city))

    if status_filter is not None:
        q = q.where(CarLead.status == status_filter)

    return list((await db.execute(q)).scalars().all())


class LeadUpdate(BaseModel):
    status: LeadStatus | None = None
    notes: str | None = None


@router.patch("/{lead_id}", response_model=LeadOut)
async def update_lead(
    lead_id: uuid.UUID,
    body: LeadUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Move a lead along the pipeline, or record what happened on the call."""
    lead = (
        await db.execute(select(CarLead).where(CarLead.id == lead_id))
    ).scalar_one_or_none()
    if lead is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lead not found")

    if user.role != UserRole.admin:
        dealer = (
            await db.execute(select(Dealer).where(Dealer.user_id == user.id))
        ).scalar_one_or_none()
        # The same city rule as the read, restated rather than assumed: an id
        # guessed from elsewhere must not be updatable by a dealer who could
        # never have seen it.
        if dealer is None or not dealer.city or dealer.city.lower() != lead.city.lower():
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your lead.")

    if body.status is not None:
        lead.status = body.status
    if body.notes is not None:
        lead.notes = body.notes

    await db.commit()
    await db.refresh(lead)
    return lead
