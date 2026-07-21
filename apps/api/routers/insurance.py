"""
Insurance enquiry router — partner quote aggregation (MOB-013).

Returns indicative motor insurance quotes from partner insurers.
Real integrations (Digit, Acko, HDFC Ergo) plug in via their REST APIs;
this file provides the full scaffold with a simulated fallback so the
mobile UI and CI both work without live credentials.
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_user
from core.limiter import limiter
from db.session import get_db
from models.user import User

router = APIRouter(prefix="/insurance", tags=["insurance"])

DbDep      = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


# ── Schemas ────────────────────────────────────────────────────────────────────

class InsuranceQuoteRequest(BaseModel):
    vehicle_make:  str   = Field(..., min_length=1, max_length=60)
    vehicle_model: str   = Field(..., min_length=1, max_length=60)
    year:          int   = Field(..., ge=1990, le=datetime.now().year + 1)
    fuel_type:     str   = Field(..., description="petrol|diesel|electric|cng|hybrid")
    idv:           int   = Field(..., ge=100_000, description="Insured declared value in ₹")
    # PII fields
    phone:         str   = Field(..., description="+91XXXXXXXXXX")
    consent:       bool  = Field(False)

    @field_validator("fuel_type")
    @classmethod
    def _fuel(cls, v: str) -> str:
        allowed = {"petrol", "diesel", "electric", "cng", "hybrid"}
        if v.lower() not in allowed:
            raise ValueError(f"fuel_type must be one of {allowed}")
        return v.lower()

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        if not re.fullmatch(r"\+91[6-9]\d{9}", v):
            raise ValueError("Phone must be a valid Indian mobile number (+91XXXXXXXXXX)")
        return v


class InsuranceQuote(BaseModel):
    insurer:     str
    logo:        str
    plan_type:   str   # comprehensive | third_party | zero_dep
    premium_pa:  int   # annual premium in ₹
    idv:         int
    features:    list[str]
    cashless_garages: int
    claim_ratio: float  # %


class InsuranceQuoteResponse(BaseModel):
    request_id: str
    quotes:     list[InsuranceQuote]
    disclaimer: str


# ── Simulated partner quotes ───────────────────────────────────────────────────

def _simulate_quotes(req: InsuranceQuoteRequest) -> list[InsuranceQuote]:
    """Deterministic simulation for dev/test; replace with real partner API calls."""
    base = req.idv * 0.025  # ~2.5% of IDV as base premium
    ev_discount = 0.9 if req.fuel_type == "electric" else 1.0

    return [
        InsuranceQuote(
            insurer="Digit Insurance",
            logo="🛡️",
            plan_type="comprehensive",
            premium_pa=int(base * ev_discount * 1.05),
            idv=req.idv,
            features=["Zero Dep Add-on", "24/7 Roadside Assist", "Engine Protect", "Key Loss Cover"],
            cashless_garages=5600,
            claim_ratio=96.5,
        ),
        InsuranceQuote(
            insurer="Acko General Insurance",
            logo="⚡",
            plan_type="comprehensive",
            premium_pa=int(base * ev_discount * 0.95),
            idv=req.idv,
            features=["Own Damage", "Third-Party Liability", "Doorstep Pickup & Drop"],
            cashless_garages=3500,
            claim_ratio=91.2,
        ),
        InsuranceQuote(
            insurer="HDFC ERGO",
            logo="🏦",
            plan_type="zero_dep",
            premium_pa=int(base * ev_discount * 1.15),
            idv=req.idv,
            features=["Zero Depreciation", "Return to Invoice", "NCB Protection", "EMI Protection"],
            cashless_garages=6500,
            claim_ratio=94.8,
        ),
        InsuranceQuote(
            insurer="TATA AIG",
            logo="🔷",
            plan_type="third_party",
            premium_pa=max(2_094, int(base * 0.20)),  # TP minimum as per IRDAI
            idv=0,
            features=["Third-Party Bodily Injury", "Property Damage up to ₹7.5L", "PA Cover"],
            cashless_garages=0,
            claim_ratio=89.3,
        ),
    ]


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/quotes", response_model=InsuranceQuoteResponse)
@limiter.limit("10/minute")
async def get_insurance_quotes(
    request: Request,
    body: InsuranceQuoteRequest,
):
    """Return indicative motor insurance quotes (no auth required — lead-gen flow)."""
    if not body.consent:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="User consent is required to fetch insurance quotes",
        )

    quotes = _simulate_quotes(body)

    return InsuranceQuoteResponse(
        request_id=str(uuid.uuid4()),
        quotes=sorted(quotes, key=lambda q: q.premium_pa),
        disclaimer=(
            "Premiums shown are indicative and subject to underwriting. "
            "Final premium may vary. IRDAI Reg. No. varies by insurer."
        ),
    )


@router.post("/enquiry", status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
async def submit_insurance_enquiry(
    request: Request,
    body: InsuranceQuoteRequest,
    current_user: CurrentUser,
):
    """Logged-in users submit a formal enquiry; partners call back within 24 hrs."""
    if not body.consent:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="User consent is required",
        )

    return {
        "enquiry_id": str(uuid.uuid4()),
        "status": "submitted",
        "message": "A partner will contact you within 24 hours on your registered number.",
        "submitted_at": datetime.now(timezone.utc).isoformat(),
    }
