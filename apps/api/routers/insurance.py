"""
Insurance enquiry router.

WHAT CHANGED HERE, AND WHY IT HAD TO

This file previously returned four quotes with premiums computed as a
percentage of IDV, attributed by name to Digit, Acko, HDFC ERGO and TATA AIG,
each with an invented claim-settlement ratio and cashless-garage count. It was
labelled a simulation in its docstring and was not one at the point of use:
the response shape is identical to a real one, and nothing downstream — a
screen, a screenshot, a user deciding what to buy — could tell the difference.

Three separate problems, any one of which is disqualifying:

  * The premiums were fabricated. GAADIIQ cannot price motor risk; it holds no
    underwriting data and no licence to do so.
  * They were attributed to real, named insurers. Publishing a price under
    another company's name, for a regulated financial product they never
    quoted, is not a placeholder.
  * The claim ratios were invented. Those are published regulatory statistics
    with real values, and the invented ones were wrong.

`/enquiry` had a quieter version of the same fault: it returned "a partner will
contact you within 24 hours" and wrote nothing to any table, so no partner
could contact anyone. A promise the system cannot keep.

Both now go through services/insurance, which raises PartnerUnavailable rather
than producing numbers. With no partner onboarded — the state at launch, since
partners are signed after the production release — /quotes returns 503 with a
machine-readable reason, and the honest journey is /interest below.

Restating the house rule this follows, from CLAUDE.md: services/credit_bureau
raises rather than returning a plausible credit score, because a generated
number is indistinguishable from a real one at the call site and would be
believed. The same holds here, more strongly.
"""
import re
from dataclasses import asdict
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_optional_user
from core.limiter import limiter
from db.session import get_db
from models.insurance import (
    InsuranceLead,
    InsuranceLeadStatus,
    InsuranceQuote,
    PolicyType,
    QuoteStatus,
)
from models.user import User
from services.insurance import (
    PartnerUnavailable,
    QuoteRequest,
    active_partner,
    next_reference,
    resolve_adapter,
)

router = APIRouter(prefix="/insurance", tags=["insurance"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
MaybeUser = Annotated[User | None, Depends(get_optional_user)]

# The exact wording a user agrees to before anything is captured. Stored on the
# lead verbatim: consent is to this sentence, and the sentence will change.
CONSENT_TEXT = (
    "I agree that GAADIIQ may contact me about insurance for this vehicle, and "
    "may share the details I have entered with a regulated insurance partner "
    "once one is available."
)

PHONE_RE = re.compile(r"\+91[6-9]\d{9}")


# ── Schemas ───────────────────────────────────────────────────────────────────


class VehicleIn(BaseModel):
    """The vehicle a quote or an enquiry is about."""

    make: str = Field(..., min_length=1, max_length=60)
    model: str = Field(..., min_length=1, max_length=60)
    variant: str | None = Field(None, max_length=120)
    fuel_type: str | None = Field(None, max_length=30)
    manufacturing_year: int | None = Field(None, ge=1980, le=datetime.now().year + 1)
    registration_no: str | None = Field(None, max_length=20)
    city: str | None = Field(None, max_length=100)
    policy_type: PolicyType = PolicyType.comprehensive

    @field_validator("fuel_type")
    @classmethod
    def _fuel(cls, v: str | None) -> str | None:
        if v is None:
            return v
        allowed = {"petrol", "diesel", "electric", "cng", "hybrid"}
        if v.lower() not in allowed:
            raise ValueError(f"fuel_type must be one of {sorted(allowed)}")
        return v.lower()


class InterestIn(VehicleIn):
    """A request to be contacted about insurance for this vehicle.

    `idv` is absent on purpose. The old endpoint took it as an input and priced
    off it; IDV is the insurer's valuation of the vehicle, not the user's, and
    asking the user to supply it invites them to believe the resulting number
    means something.
    """

    existing_policy_expiry: date | None = None
    existing_insurer: str | None = Field(None, max_length=160)
    name: str | None = Field(None, max_length=160)
    phone: str = Field(..., description="+91XXXXXXXXXX")
    email: str | None = Field(None, max_length=255)
    consent: bool = Field(False)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        if not PHONE_RE.fullmatch(v):
            raise ValueError("Phone must be a valid Indian mobile number (+91XXXXXXXXXX)")
        return v


class QuoteOut(BaseModel):
    """One plan, exactly as a partner described it. No GAADIIQ-derived field."""

    insurer_name: str
    plan_name: str
    policy_type: str
    premium: float
    idv: float | None = None
    coverages: list[str] = []
    add_ons: list[str] = []
    purchase_url: str | None = None


class QuotesOut(BaseModel):
    reference: str
    #: Who supplied these, so the accountable party is named alongside the
    #: numbers rather than implied to be GAADIIQ (BRD §22).
    partner_name: str
    partner_registration_no: str | None = None
    quotes: list[QuoteOut]
    disclaimer: str


class InterestOut(BaseModel):
    id: str
    status: str
    message: str


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/quotes", response_model=QuotesOut)
@limiter.limit("10/minute")
async def get_insurance_quotes(
    request: Request,
    body: VehicleIn,
    db: DbDep,
    current_user: MaybeUser = None,
):
    """Quotes from the configured insurance partner.

    Returns 503 when no partner can answer. That is the expected response until
    a partner is onboarded, and the client is expected to offer /interest
    instead — see the module docstring for why there is no fallback that
    produces numbers.
    """
    try:
        partner = await active_partner(db)
        adapter = resolve_adapter(partner)
    except PartnerUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"reason": exc.reason, "message": str(exc)},
        ) from exc

    # The reference is minted before the call so it can be handed to the
    # partner, which is what lets them echo it back on conversion (BRD §12).
    reference = await next_reference(db)

    quote = InsuranceQuote(
        reference=reference,
        user_id=current_user.id if current_user else None,
        partner_id=partner.id,
        make=body.make,
        model=body.model,
        variant=body.variant,
        fuel_type=body.fuel_type,
        manufacturing_year=body.manufacturing_year,
        registration_no=body.registration_no,
        policy_type=body.policy_type,
        quote_status=QuoteStatus.requested,
    )
    db.add(quote)
    await db.flush()

    try:
        partner_quotes = await adapter.fetch_quotes(
            QuoteRequest(
                make=body.make,
                model=body.model,
                variant=body.variant,
                fuel_type=body.fuel_type,
                manufacturing_year=body.manufacturing_year,
                registration_no=body.registration_no,
                city=body.city,
                policy_type=body.policy_type.value,
                reference=reference,
            )
        )
    except PartnerUnavailable as exc:
        # The failed attempt is kept rather than rolled back. A partner that
        # stops answering shows up as a run of `failed` rows against its id;
        # discarding them would make an outage look like an absence of demand.
        #
        # The commit is not optional and is easy to leave out: raising
        # HTTPException unwinds through the get_db dependency, which rolls the
        # session back, so without this the row is silently discarded and the
        # comment above becomes a false claim. A test asserts the row survives.
        quote.quote_status = QuoteStatus.failed
        quote.failure_reason = str(exc)
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"reason": exc.reason, "message": str(exc)},
        ) from exc

    quote.quote_status = QuoteStatus.returned
    # Verbatim, so "what did we display and who told us to" stays answerable
    # after the partner's own record has aged out. See models/insurance.py.
    quote.raw_response = {"plans": [asdict(q) for q in partner_quotes]}

    return QuotesOut(
        reference=reference,
        partner_name=partner.name,
        partner_registration_no=partner.registration_no,
        quotes=[QuoteOut(**asdict(q)) for q in partner_quotes],
        disclaimer=(
            f"Premiums and cover are supplied by {partner.name} and are subject "
            "to their underwriting. GAADIIQ does not price, underwrite or issue "
            "insurance."
        ),
    )


@router.post(
    "/interest", response_model=InterestOut, status_code=status.HTTP_201_CREATED
)
@limiter.limit("5/minute")
async def register_insurance_interest(
    request: Request,
    body: InterestIn,
    db: DbDep,
    current_user: MaybeUser = None,
):
    """Record that someone wants insurance for a vehicle, with their consent.

    This is the whole insurance journey until a partner is onboarded, and it is
    a real one: it captures demand that would otherwise be discarded, and that
    demand is the evidence shown to a prospective partner.

    It promises only what it can deliver. The old /enquiry told the user a
    partner would call within 24 hours; the message below says they will be
    contacted when insurance goes live, which is true.

    Open to guests. Requiring an account here would lose most of the demand
    this exists to measure, and the phone number is the identifier that
    matters.
    """
    if not body.consent:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Consent is required before your details can be recorded.",
        )

    lead = InsuranceLead(
        # No quote and no partner: an interest lead. See models/insurance.py.
        quote_id=None,
        partner_id=None,
        user_id=current_user.id if current_user else None,
        make=body.make,
        model=body.model,
        variant=body.variant,
        fuel_type=body.fuel_type,
        manufacturing_year=body.manufacturing_year,
        registration_no=body.registration_no,
        city=body.city,
        existing_policy_expiry=body.existing_policy_expiry,
        existing_insurer=body.existing_insurer,
        name=body.name,
        phone=body.phone,
        email=body.email,
        consented_at=datetime.now(timezone.utc),
        consent_text=CONSENT_TEXT,
        # Stays null: nothing has been shared, because there is nobody to share
        # it with. The column records reality, not intent.
        shared_with_partner_at=None,
        lead_status=InsuranceLeadStatus.consented,
    )
    db.add(lead)
    await db.flush()

    return InterestOut(
        id=str(lead.id),
        status=lead.lead_status.value,
        message=(
            "Thanks — we have your details. We will contact you when insurance "
            "goes live on GAADIIQ."
        ),
    )
