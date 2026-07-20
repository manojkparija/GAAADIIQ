"""
Customer Sentiment & Purchase Intent Analysis — dealer-facing API.

Endpoints:
  POST /sentiment/track          — log a customer activity event
  POST /sentiment/analyse/{uid} — (re)score a customer's intent
  GET  /sentiment/leads          — ranked lead list for the current dealer
  GET  /sentiment/leads/{uid}    — detailed intent report for one customer
  GET  /sentiment/summary        — dashboard KPIs (grade counts, avg score, etc.)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_user
from core.limiter import limiter
from db.session import get_db
from models.customer_intent import (
    ActivityType,
    CustomerActivity,
    CustomerIntentScore,
    LeadGrade,
)
from models.dealer import Dealer
from models.user import User
from services.sentiment import analyse_customer_intent

router = APIRouter(prefix="/sentiment", tags=["sentiment"])

CurrentUser = Annotated[User, Depends(get_current_user)]
DB = Annotated[AsyncSession, Depends(get_db)]


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class TrackPublicIn(BaseModel):
    dealer_email: str
    buyer_id: str
    activity_type: ActivityType
    duration_seconds: int | None = None
    metadata: dict | None = None


class TrackActivityIn(BaseModel):
    user_id: str
    activity_type: ActivityType
    listing_id: str | None = None
    duration_seconds: int | None = None
    metadata: dict | None = None


class AnalyseIn(BaseModel):
    customer_name: str = "Customer"


class IntentScoreOut(BaseModel):
    user_id: str
    customer_name: str
    intent_score: float
    lead_grade: str
    engagement_score: float
    urgency_score: float
    budget_fit_score: float
    sentiment_score: float
    next_best_action: str | None
    best_contact_time: str | None
    predicted_purchase_window: str | None
    llm_reasoning: str | None
    total_views: int
    total_enquiries: int
    total_test_drives: int
    total_loan_inquiries: int
    revisit_count: int
    scored_at: datetime | None
    ollama_used: bool

    model_config = {"from_attributes": True}


class LeadOut(BaseModel):
    user_id: str
    customer_name: str
    email: str | None
    phone: str | None
    intent_score: float
    lead_grade: str
    next_best_action: str | None
    best_contact_time: str | None
    predicted_purchase_window: str | None
    total_enquiries: int
    total_test_drives: int
    scored_at: datetime | None


class SummaryOut(BaseModel):
    total_leads: int
    grade_a: int
    grade_b: int
    grade_c: int
    grade_d: int
    avg_score: float
    hot_leads: int           # score >= 80
    needs_followup: int      # scored > 7 days ago
    analysed_today: int


# ── Helpers ───────────────────────────────────────────────────────────────────

def _aware_dt(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


async def _get_dealer(db: AsyncSession, user: User) -> Dealer:
    q = await db.execute(select(Dealer).where(Dealer.user_id == user.id))
    dealer = q.scalar_one_or_none()
    if not dealer:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Dealer profile not found")
    return dealer


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/track-public", status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
async def track_activity_public(request: Request, body: TrackPublicIn, db: DB):
    """
    Unauthenticated buyer-side tracking endpoint.
    Looks up dealer by email and records the customer activity signal.
    Rate-limited to 30 req/min per IP.
    """
    # Resolve dealer via their user email
    user_q = await db.execute(select(User).where(User.email == body.dealer_email))
    dealer_user = user_q.scalar_one_or_none()
    if not dealer_user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dealer not found")

    dealer_q = await db.execute(select(Dealer).where(Dealer.user_id == dealer_user.id))
    dealer = dealer_q.scalar_one_or_none()
    if not dealer:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dealer profile not found")

    activity = CustomerActivity(
        user_id=body.buyer_id,
        dealer_id=str(dealer.id),
        activity_type=body.activity_type,
        duration_seconds=body.duration_seconds,
        extra_data=body.metadata,
    )
    db.add(activity)
    await db.commit()
    return {"status": "tracked"}


@router.post("/track", status_code=status.HTTP_201_CREATED)
async def track_activity(body: TrackActivityIn, db: DB, current_user: CurrentUser):
    """
    Record a customer activity signal.
    Call this from the Angular frontend whenever a user views a listing,
    submits an enquiry, requests a test drive, etc.
    """
    dealer = await _get_dealer(db, current_user)
    activity = CustomerActivity(
        user_id=body.user_id,
        dealer_id=str(dealer.id),
        listing_id=body.listing_id,
        activity_type=body.activity_type,
        duration_seconds=body.duration_seconds,
        extra_data=body.metadata,
    )
    db.add(activity)
    await db.commit()
    return {"status": "tracked"}


@router.post("/analyse/{user_id}", response_model=IntentScoreOut)
async def analyse_customer(
    user_id: str,
    body: AnalyseIn,
    db: DB,
    current_user: CurrentUser,
):
    """
    Trigger (or refresh) an AI intent analysis for a specific customer.
    Gathers all signals → calls Ollama → returns structured intent score.
    """
    dealer = await _get_dealer(db, current_user)

    # Resolve customer name from DB if not supplied
    name = body.customer_name
    if name == "Customer":
        user_q = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
        user = user_q.scalar_one_or_none()
        if user:
            name = user.full_name or user.email or "Customer"

    score = await analyse_customer_intent(db, user_id, str(dealer.id), name)

    # Enrich with user info
    user_q = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = user_q.scalar_one_or_none()

    return IntentScoreOut(
        user_id=score.user_id,
        customer_name=name,
        intent_score=score.intent_score,
        lead_grade=score.lead_grade.value,
        engagement_score=score.engagement_score,
        urgency_score=score.urgency_score,
        budget_fit_score=score.budget_fit_score,
        sentiment_score=score.sentiment_score,
        next_best_action=score.next_best_action,
        best_contact_time=score.best_contact_time,
        predicted_purchase_window=score.predicted_purchase_window,
        llm_reasoning=score.llm_reasoning,
        total_views=score.total_views,
        total_enquiries=score.total_enquiries,
        total_test_drives=score.total_test_drives,
        total_loan_inquiries=score.total_loan_inquiries,
        revisit_count=score.revisit_count,
        scored_at=score.scored_at,
        ollama_used=score.ollama_used,
    )


@router.get("/leads", response_model=list[LeadOut])
async def list_leads(
    db: DB,
    current_user: CurrentUser,
    grade: str | None = Query(None, description="Filter by grade A/B/C/D"),
    min_score: float = Query(0, ge=0, le=100),
    limit: int = Query(50, ge=1, le=200),
):
    """
    Return ranked lead list for this dealer, sorted by intent_score DESC.
    """
    dealer = await _get_dealer(db, current_user)

    q = select(CustomerIntentScore).where(
        CustomerIntentScore.dealer_id == str(dealer.id),
        CustomerIntentScore.intent_score >= min_score,
    )
    if grade:
        q = q.where(CustomerIntentScore.lead_grade == LeadGrade(grade.upper()))
    q = q.order_by(CustomerIntentScore.intent_score.desc()).limit(limit)

    result = await db.execute(q)
    scores = result.scalars().all()

    # Batch-load users
    user_ids = [s.user_id for s in scores]
    users_q = await db.execute(select(User).where(User.id.in_([uuid.UUID(uid) for uid in user_ids])))
    users = {u.id: u for u in users_q.scalars().all()}

    leads: list[LeadOut] = []
    for s in scores:
        u = users.get(s.user_id)
        leads.append(LeadOut(
            user_id=s.user_id,
            customer_name=u.full_name or u.email or "Unknown" if u else "Unknown",
            email=u.email if u else None,
            phone=u.phone if u else None,
            intent_score=s.intent_score,
            lead_grade=s.lead_grade.value,
            next_best_action=s.next_best_action,
            best_contact_time=s.best_contact_time,
            predicted_purchase_window=s.predicted_purchase_window,
            total_enquiries=s.total_enquiries,
            total_test_drives=s.total_test_drives,
            scored_at=s.scored_at,
        ))
    return leads


@router.get("/leads/{user_id}", response_model=IntentScoreOut)
async def get_lead_detail(user_id: str, db: DB, current_user: CurrentUser):
    """Full intent report for a single customer."""
    dealer = await _get_dealer(db, current_user)

    q = await db.execute(
        select(CustomerIntentScore).where(
            CustomerIntentScore.user_id == user_id,
            CustomerIntentScore.dealer_id == str(dealer.id),
        )
    )
    score = q.scalar_one_or_none()
    if not score:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No intent score found for this customer")

    user_q = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = user_q.scalar_one_or_none()
    name = user.full_name or user.email or "Customer" if user else "Customer"

    return IntentScoreOut(
        user_id=score.user_id,
        customer_name=name,
        intent_score=score.intent_score,
        lead_grade=score.lead_grade.value,
        engagement_score=score.engagement_score,
        urgency_score=score.urgency_score,
        budget_fit_score=score.budget_fit_score,
        sentiment_score=score.sentiment_score,
        next_best_action=score.next_best_action,
        best_contact_time=score.best_contact_time,
        predicted_purchase_window=score.predicted_purchase_window,
        llm_reasoning=score.llm_reasoning,
        total_views=score.total_views,
        total_enquiries=score.total_enquiries,
        total_test_drives=score.total_test_drives,
        total_loan_inquiries=score.total_loan_inquiries,
        revisit_count=score.revisit_count,
        scored_at=score.scored_at,
        ollama_used=score.ollama_used,
    )


@router.get("/summary", response_model=SummaryOut)
async def get_summary(db: DB, current_user: CurrentUser):
    """Dashboard KPIs for the sentiment panel."""
    dealer = await _get_dealer(db, current_user)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)

    q = await db.execute(
        select(CustomerIntentScore).where(CustomerIntentScore.dealer_id == str(dealer.id))
    )
    all_scores = q.scalars().all()

    if not all_scores:
        return SummaryOut(
            total_leads=0, grade_a=0, grade_b=0, grade_c=0, grade_d=0,
            avg_score=0.0, hot_leads=0, needs_followup=0, analysed_today=0,
        )

    return SummaryOut(
        total_leads=len(all_scores),
        grade_a=sum(1 for s in all_scores if s.lead_grade == LeadGrade.A),
        grade_b=sum(1 for s in all_scores if s.lead_grade == LeadGrade.B),
        grade_c=sum(1 for s in all_scores if s.lead_grade == LeadGrade.C),
        grade_d=sum(1 for s in all_scores if s.lead_grade == LeadGrade.D),
        avg_score=round(sum(s.intent_score for s in all_scores) / len(all_scores), 1),
        hot_leads=sum(1 for s in all_scores if s.intent_score >= 80),
        needs_followup=sum(
            1 for s in all_scores
            if s.scored_at and _aware_dt(s.scored_at) < week_ago and s.intent_score >= 60
        ),
        analysed_today=sum(
            1 for s in all_scores
            if s.scored_at and _aware_dt(s.scored_at) >= today_start
        ),
    )
