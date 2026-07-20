"""Customer intent & activity tracking models."""
from __future__ import annotations

from datetime import datetime
from enum import Enum as PyEnum

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, TimestampMixin, UUIDMixin


class ActivityType(str, PyEnum):
    listing_view = "listing_view"
    search = "search"
    enquiry = "enquiry"
    test_drive_request = "test_drive_request"
    loan_inquiry = "loan_inquiry"
    price_alert = "price_alert"
    whatsapp_click = "whatsapp_click"
    photo_view = "photo_view"
    compare = "compare"
    revisit = "revisit"
    brochure_download = "brochure_download"


class LeadGrade(str, PyEnum):
    A = "A"  # 80–100 — hot, act now
    B = "B"  # 60–79  — warm, follow up today
    C = "C"  # 40–59  — cool, nurture
    D = "D"  # 0–39   — cold


class CustomerActivity(UUIDMixin, TimestampMixin, Base):
    """Raw event log — one row per customer interaction."""

    __tablename__ = "customer_activities"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    dealer_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("dealers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    listing_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("listings.id", ondelete="SET NULL"), nullable=True
    )
    activity_type: Mapped[ActivityType] = mapped_column(
        Enum(ActivityType), nullable=False
    )
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    extra_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    __table_args__ = (
        Index("ix_ca_user_dealer", "user_id", "dealer_id"),
        Index("ix_ca_created", "created_at"),
    )


class CustomerIntentScore(UUIDMixin, TimestampMixin, Base):
    """AI-generated purchase intent score per customer per dealer."""

    __tablename__ = "customer_intent_scores"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    dealer_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("dealers.id", ondelete="CASCADE"), nullable=False
    )

    # Score 0–100
    intent_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    lead_grade: Mapped[LeadGrade] = mapped_column(Enum(LeadGrade), nullable=False, default=LeadGrade.D)

    # Sub-scores (0–100 each)
    engagement_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    urgency_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    budget_fit_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    sentiment_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    # LLM outputs
    llm_reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)
    next_best_action: Mapped[str | None] = mapped_column(String(200), nullable=True)
    best_contact_time: Mapped[str | None] = mapped_column(String(100), nullable=True)
    predicted_purchase_window: Mapped[str | None] = mapped_column(String(50), nullable=True)
    interested_cars: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # Signal counts used in analysis
    total_views: Mapped[int] = mapped_column(Integer, default=0)
    total_enquiries: Mapped[int] = mapped_column(Integer, default=0)
    total_test_drives: Mapped[int] = mapped_column(Integer, default=0)
    total_loan_inquiries: Mapped[int] = mapped_column(Integer, default=0)
    revisit_count: Mapped[int] = mapped_column(Integer, default=0)

    scored_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    ollama_used: Mapped[bool] = mapped_column(Boolean, default=False)

    __table_args__ = (
        Index("ix_cis_dealer_score", "dealer_id", "intent_score"),
        Index("ix_cis_user_dealer", "user_id", "dealer_id", unique=True),
    )
