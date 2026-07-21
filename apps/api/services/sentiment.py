"""
Customer Sentiment & Purchase Intent Analysis Service.

Signal aggregation → Ollama LLM scoring → structured intent score (0–100).

Primary:  Ollama (llama3/mistral) via LangChain — structured JSON output.
Fallback: Rule-based heuristic when Ollama is unavailable.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from langchain_community.llms.ollama import Ollama
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from models.customer_intent import (
    ActivityType,
    CustomerActivity,
    CustomerIntentScore,
    LeadGrade,
)
from models.listing import Listing
from models.loan_inquiry import LoanInquiry
from models.price_alert import PriceAlert
from models.test_drive_booking import TestDriveBooking

logger = logging.getLogger(__name__)

# ── Prompt injection fence ────────────────────────────────────────────────────
_INJECTION_PATTERN = re.compile(
    r"(ignore\s+(previous|all|prior)|forget\s+(your|all)|you\s+are\s+now|"
    r"system\s*prompt|<\s*/?system\s*>|<\s*/?instruction|"
    r"\[/?INST\]|###\s*instruction|act\s+as\s+(a\s+)?new)",
    re.IGNORECASE,
)

def _sanitise(text: str, max_len: int = 500) -> str:
    """Strip prompt-injection attempts and truncate."""
    text = str(text)[:max_len]
    return _INJECTION_PATTERN.sub("[REDACTED]", text)

# ── Circuit breaker (mirrors valuation.py pattern) ────────────────────────────
_cb_failures = 0
_cb_open_until: float = 0.0
_CB_THRESHOLD = 3
_CB_COOLDOWN = 60.0

_INTENT_PROMPT = PromptTemplate.from_template(
    """You are an expert automotive sales analyst for the Indian car market.
Analyse the following customer signals and return a JSON purchase intent assessment.

Customer signals:
- Name: {customer_name}
- Total listing views: {total_views}
- Unique cars viewed: {unique_cars}
- Most viewed cars: {top_cars}
- Enquiries submitted: {total_enquiries}
- Test drive requests: {total_test_drives}
- Loan inquiries submitted: {total_loan_inquiries}
- Price alerts set: {price_alerts}
- Revisit count (returning to same listing): {revisit_count}
- Average time on listing (seconds): {avg_duration}
- Days since first activity: {days_active}
- Days since last activity: {days_since_last}
- Conversation snippets / enquiry notes: {enquiry_notes}
- Budget signals from enquiries: {budget_signals}

Scoring rubric:
- 80–100: Hot lead — multiple strong signals, act immediately
- 60–79:  Warm lead — clear intent, follow up today
- 40–59:  Cool lead — some interest, nurture with content
- 0–39:   Cold lead — minimal signals, low priority

Respond ONLY with valid JSON matching this exact schema:
{{
  "intent_score": <integer 0-100>,
  "lead_grade": "<A|B|C|D>",
  "engagement_score": <integer 0-100>,
  "urgency_score": <integer 0-100>,
  "budget_fit_score": <integer 0-100>,
  "sentiment_score": <integer 0-100>,
  "next_best_action": "<one specific action the dealer should take, max 60 chars>",
  "best_contact_time": "<e.g. Morning 10am-12pm or Evening 6-8pm>",
  "predicted_purchase_window": "<e.g. This week | 1-2 weeks | 1 month | 3+ months>",
  "reasoning": "<2-3 sentence summary of why this score was assigned>"
}}"""
)


def _grade(score: float) -> LeadGrade:
    if score >= 80:
        return LeadGrade.A
    if score >= 60:
        return LeadGrade.B
    if score >= 40:
        return LeadGrade.C
    return LeadGrade.D


def _heuristic_score(signals: dict[str, Any]) -> dict[str, Any]:
    """Rule-based fallback when Ollama is unavailable."""
    views = signals.get("total_views", 0)
    enquiries = signals.get("total_enquiries", 0)
    test_drives = signals.get("total_test_drives", 0)
    loans = signals.get("total_loan_inquiries", 0)
    revisits = signals.get("revisit_count", 0)
    alerts = signals.get("price_alerts", 0)
    days_last = signals.get("days_since_last", 30)

    engagement = min(100, views * 3 + revisits * 8 + alerts * 10)
    urgency = min(100, max(0, 80 - days_last * 4) + test_drives * 20)
    budget_fit = min(100, loans * 40 + enquiries * 15)
    sentiment = min(100, enquiries * 20 + test_drives * 30)

    weights = [0.30, 0.25, 0.25, 0.20]
    score = (
        engagement * weights[0]
        + urgency * weights[1]
        + budget_fit * weights[2]
        + sentiment * weights[3]
    )
    score = round(min(100, max(0, score)), 1)
    grade = _grade(score)

    nba_map = {
        LeadGrade.A: "Call now — schedule test drive",
        LeadGrade.B: "Send personalised offer today",
        LeadGrade.C: "Share brochure & EMI calculator",
        LeadGrade.D: "Add to drip campaign",
    }

    return {
        "intent_score": score,
        "lead_grade": grade.value,
        "engagement_score": round(engagement, 1),
        "urgency_score": round(urgency, 1),
        "budget_fit_score": round(budget_fit, 1),
        "sentiment_score": round(sentiment, 1),
        "next_best_action": nba_map[grade],
        "best_contact_time": "Morning 10am–12pm",
        "predicted_purchase_window": "1-2 weeks" if score >= 70 else "1 month" if score >= 50 else "3+ months",
        "reasoning": f"Heuristic score based on {views} views, {enquiries} enquiries, {test_drives} test drives, {loans} loan inquiries.",
        "ollama_used": False,
    }


async def _call_ollama(signals: dict[str, Any]) -> dict[str, Any] | None:
    """Call Ollama via LangChain; returns parsed dict or None on failure."""
    global _cb_failures, _cb_open_until
    import time

    if time.time() < _cb_open_until:
        logger.debug("Sentiment circuit breaker open, skipping Ollama")
        return None

    try:
        llm = Ollama(
            base_url=settings.ollama_url,
            model=settings.ollama_model,
            temperature=0.1,
            timeout=30,
        )
        chain = _INTENT_PROMPT | llm | StrOutputParser()
        raw = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, lambda: chain.invoke(signals)),
            timeout=35,
        )
        # Extract JSON from response
        match = re.search(r"\{[\s\S]*\}", raw)
        if not match:
            raise ValueError("No JSON found in Ollama response")
        result = json.loads(match.group())
        _cb_failures = 0
        return result
    except Exception as exc:
        _cb_failures += 1
        logger.warning("Ollama sentiment call failed (%d): %s", _cb_failures, exc)
        if _cb_failures >= _CB_THRESHOLD:
            _cb_open_until = time.time() + _CB_COOLDOWN
            logger.warning("Sentiment circuit breaker opened for %ss", _CB_COOLDOWN)
        return None


async def _gather_signals(
    db: AsyncSession, user_id: str, dealer_id: str
) -> dict[str, Any]:
    """Aggregate all customer signals for a given user+dealer pair."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=90)

    # Activities
    acts_q = await db.execute(
        select(CustomerActivity).where(
            CustomerActivity.user_id == user_id,
            CustomerActivity.dealer_id == dealer_id,
            CustomerActivity.created_at >= cutoff,
        )
    )
    activities = acts_q.scalars().all()

    views = [a for a in activities if a.activity_type == ActivityType.listing_view]
    revisits = [a for a in activities if a.activity_type == ActivityType.revisit]
    enquiry_acts = [a for a in activities if a.activity_type == ActivityType.enquiry]

    # Listing IDs this customer interacted with
    listing_ids = list({a.listing_id for a in activities if a.listing_id})

    # Top cars from listing metadata
    top_cars: list[str] = []
    if listing_ids:
        listings_q = await db.execute(
            select(Listing).where(Listing.id.in_(listing_ids[:10]))
        )
        top_cars = [
            f"{row.car.make if row.car else ''} {row.car.model if row.car else ''}".strip()
            for row in listings_q.scalars().all()
        ]

    # Test drives
    td_q = await db.execute(
        select(TestDriveBooking).where(
            TestDriveBooking.user_id == user_id,
            TestDriveBooking.listing_id.in_(listing_ids) if listing_ids else False,
            TestDriveBooking.created_at >= cutoff,
        )
    )
    test_drives = td_q.scalars().all()

    # Loan inquiries
    loan_q = await db.execute(
        select(LoanInquiry).where(
            LoanInquiry.user_id == user_id,
            LoanInquiry.listing_id.in_(listing_ids) if listing_ids else False,
            LoanInquiry.created_at >= cutoff,
        )
    )
    loans = loan_q.scalars().all()

    # Price alerts
    alert_q = await db.execute(
        select(PriceAlert).where(
            PriceAlert.user_id == user_id,
            PriceAlert.listing_id.in_(listing_ids) if listing_ids else False,
        )
    )
    alerts = alert_q.scalars().all()

    # Time calculations
    def _aware(dt: datetime) -> datetime:
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt

    all_times = [_aware(a.created_at) for a in activities if a.created_at]
    days_active = (now - min(all_times)).days if all_times else 0
    days_since_last = (now - max(all_times)).days if all_times else 99

    avg_duration = 0
    durations = [a.duration_seconds for a in views if a.duration_seconds]
    if durations:
        avg_duration = sum(durations) // len(durations)

    # Enquiry notes from metadata
    notes = [
        a.extra_data.get("notes", "")
        for a in enquiry_acts
        if a.extra_data and a.extra_data.get("notes")
    ]
    enquiry_notes = "; ".join(_sanitise(n) for n in notes[:3]) if notes else "No notes available"

    budget_signals = [
        a.extra_data.get("budget", "")
        for a in activities
        if a.extra_data and a.extra_data.get("budget")
    ]
    budget_str = ", ".join(budget_signals[:2]) if budget_signals else "Not specified"

    return {
        "total_views": len(views),
        "unique_cars": len(set(a.listing_id for a in views if a.listing_id)),
        "top_cars": ", ".join(top_cars[:3]) or "Not specified",
        "total_enquiries": len(enquiry_acts),
        "total_test_drives": len(test_drives),
        "total_loan_inquiries": len(loans),
        "price_alerts": len(alerts),
        "revisit_count": len(revisits),
        "avg_duration": avg_duration,
        "days_active": days_active,
        "days_since_last": days_since_last,
        "enquiry_notes": enquiry_notes,
        "budget_signals": budget_str,
        "listing_ids": listing_ids,
    }


async def analyse_customer_intent(
    db: AsyncSession,
    user_id: str,
    dealer_id: str,
    customer_name: str = "Customer",
) -> CustomerIntentScore:
    """
    Main entry point. Gathers signals, calls Ollama, persists & returns score.
    """
    signals = await _gather_signals(db, user_id, dealer_id)
    signals["customer_name"] = customer_name

    # Try Ollama first, fall back to heuristic
    llm_result = await _call_ollama(signals)
    if llm_result:
        result = llm_result
        result["ollama_used"] = True
    else:
        result = _heuristic_score(signals)

    # Upsert intent score record
    existing_q = await db.execute(
        select(CustomerIntentScore).where(
            CustomerIntentScore.user_id == user_id,
            CustomerIntentScore.dealer_id == dealer_id,
        )
    )
    score_row = existing_q.scalar_one_or_none()
    if not score_row:
        score_row = CustomerIntentScore(user_id=user_id, dealer_id=dealer_id)
        db.add(score_row)

    score_row.intent_score = float(result.get("intent_score", 0))
    score_row.lead_grade = LeadGrade(result.get("lead_grade", "D"))
    score_row.engagement_score = float(result.get("engagement_score", 0))
    score_row.urgency_score = float(result.get("urgency_score", 0))
    score_row.budget_fit_score = float(result.get("budget_fit_score", 0))
    score_row.sentiment_score = float(result.get("sentiment_score", 0))
    score_row.llm_reasoning = result.get("reasoning")
    score_row.next_best_action = result.get("next_best_action")
    score_row.best_contact_time = result.get("best_contact_time")
    score_row.predicted_purchase_window = result.get("predicted_purchase_window")
    score_row.interested_cars = signals["listing_ids"][:5]
    score_row.total_views = signals["total_views"]
    score_row.total_enquiries = signals["total_enquiries"]
    score_row.total_test_drives = signals["total_test_drives"]
    score_row.total_loan_inquiries = signals["total_loan_inquiries"]
    score_row.revisit_count = signals["revisit_count"]
    score_row.scored_at = datetime.now(timezone.utc)
    score_row.ollama_used = result.get("ollama_used", False)

    await db.commit()
    await db.refresh(score_row)
    return score_row
