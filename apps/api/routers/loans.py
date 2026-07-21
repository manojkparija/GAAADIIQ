import math
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.dependencies import get_current_user
from db.session import get_db
from models.listing import Listing
from models.loan_inquiry import LoanInquiry
from models.user import User
from schemas.loan import EMIResult, LoanInquiryCreate, LoanInquiryOut
from services.notifications import notify_loan_inquiry_received

router = APIRouter(prefix="/loans", tags=["loans"])


# ── Bank rates (used by Angular EMI calculator to avoid hard-coded stubs) ────

_BANK_RATES = [
    {"name": "SBI",           "rate": 8.45, "logo": "🏦"},
    {"name": "HDFC Bank",     "rate": 8.75, "logo": "🏛"},
    {"name": "ICICI Bank",    "rate": 8.85, "logo": "💳"},
    {"name": "Axis Bank",     "rate": 9.00, "logo": "🔵"},
    {"name": "Kotak Mahindra","rate": 8.65, "logo": "🟠"},
    {"name": "Bank of Baroda","rate": 8.55, "logo": "🏦"},
    {"name": "PNB",           "rate": 8.70, "logo": "🔶"},
]

@router.get("/bank-rates")
async def get_bank_rates():
    """Return indicative auto-loan interest rates by bank (MOB-031)."""
    return {"banks": _BANK_RATES, "note": "Rates are indicative; contact bank for confirmed offer."}


# ── EMI calculator ────────────────────────────────────────────────────────────

@router.get("/emi-calculator", response_model=EMIResult)
async def emi_calculator(
    principal: float = Query(..., gt=0, description="Loan amount in INR"),
    annual_rate: float = Query(..., gt=0, le=50, description="Annual interest rate (%)"),
    tenure_months: int = Query(..., ge=6, le=360, description="Loan tenure in months"),
):
    """
    Standard reducing-balance EMI formula:
        EMI = P × r × (1 + r)^n / ((1 + r)^n − 1)
    where r = monthly rate = annual_rate / 1200
    """
    r = annual_rate / 1200  # monthly rate as decimal
    n = tenure_months

    if r == 0:
        monthly_emi = principal / n
    else:
        monthly_emi = principal * r * math.pow(1 + r, n) / (math.pow(1 + r, n) - 1)

    total_payment = monthly_emi * n
    total_interest = total_payment - principal

    return EMIResult(
        principal=round(principal, 2),
        annual_rate=annual_rate,
        tenure_months=tenure_months,
        monthly_emi=round(monthly_emi, 2),
        total_payment=round(total_payment, 2),
        total_interest=round(total_interest, 2),
        down_payment_20pct=round(principal * 0.20, 2),
    )


# ── Loan inquiries ────────────────────────────────────────────────────────────

@router.post("/inquiries", response_model=LoanInquiryOut, status_code=status.HTTP_201_CREATED)
async def create_loan_inquiry(
    payload: LoanInquiryCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    listing_result = await db.execute(
        select(Listing)
        .where(Listing.id == payload.listing_id, Listing.is_active == True)  # noqa: E712
        .options(selectinload(Listing.seller), selectinload(Listing.car))
    )
    listing = listing_result.scalar_one_or_none()
    if not listing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Listing not found")

    inquiry = LoanInquiry(user_id=current_user.id, **payload.model_dump())
    db.add(inquiry)
    await db.commit()
    await db.refresh(inquiry)

    car = listing.car
    listing_title = f"{car.year} {car.make} {car.model}" if car else "your listing"
    background_tasks.add_task(
        notify_loan_inquiry_received,
        db,
        listing.seller,
        listing_title,
        listing.id,
        payload.loan_amount,
    )

    return LoanInquiryOut.model_validate(inquiry)


@router.get("/inquiries", response_model=list[LoanInquiryOut])
async def list_my_loan_inquiries(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Loan inquiries I submitted (as a buyer)."""
    result = await db.execute(
        select(LoanInquiry)
        .where(LoanInquiry.user_id == current_user.id)
        .order_by(LoanInquiry.created_at.desc())
    )
    return [LoanInquiryOut.model_validate(i) for i in result.scalars().all()]


@router.get("/inquiries/received", response_model=list[LoanInquiryOut])
async def list_received_loan_inquiries(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Loan inquiries on my listings (seller view)."""
    result = await db.execute(
        select(LoanInquiry)
        .join(Listing, LoanInquiry.listing_id == Listing.id)
        .where(Listing.seller_id == current_user.id)
        .order_by(LoanInquiry.created_at.desc())
    )
    return [LoanInquiryOut.model_validate(i) for i in result.scalars().all()]


@router.get("/inquiries/{inquiry_id}", response_model=LoanInquiryOut)
async def get_loan_inquiry(
    inquiry_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(LoanInquiry).where(
            LoanInquiry.id == inquiry_id,
            LoanInquiry.user_id == current_user.id,
        )
    )
    inquiry = result.scalar_one_or_none()
    if not inquiry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Inquiry not found")
    return LoanInquiryOut.model_validate(inquiry)
