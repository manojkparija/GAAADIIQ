"""Add customer_activities and customer_intent_scores tables.

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-19
"""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "customer_activities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("dealer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("dealers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("listings.id", ondelete="SET NULL"), nullable=True),
        sa.Column("activity_type", sa.Enum(
            "listing_view", "search", "enquiry", "test_drive_request",
            "loan_inquiry", "price_alert", "whatsapp_click", "photo_view",
            "compare", "revisit", "brochure_download",
            name="activitytype"
        ), nullable=False),
        sa.Column("duration_seconds", sa.Integer, nullable=True),
        sa.Column("extra_data", sa.JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ca_user_dealer", "customer_activities", ["user_id", "dealer_id"])
    op.create_index("ix_ca_created", "customer_activities", ["created_at"])

    op.create_table(
        "customer_intent_scores",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("dealer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("dealers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("intent_score", sa.Float, nullable=False, default=0.0),
        sa.Column("lead_grade", sa.Enum("A", "B", "C", "D", name="leadgrade"), nullable=False, default="D"),
        sa.Column("engagement_score", sa.Float, nullable=False, default=0.0),
        sa.Column("urgency_score", sa.Float, nullable=False, default=0.0),
        sa.Column("budget_fit_score", sa.Float, nullable=False, default=0.0),
        sa.Column("sentiment_score", sa.Float, nullable=False, default=0.0),
        sa.Column("llm_reasoning", sa.Text, nullable=True),
        sa.Column("next_best_action", sa.String(200), nullable=True),
        sa.Column("best_contact_time", sa.String(100), nullable=True),
        sa.Column("predicted_purchase_window", sa.String(50), nullable=True),
        sa.Column("interested_cars", sa.JSON, nullable=True),
        sa.Column("total_views", sa.Integer, default=0),
        sa.Column("total_enquiries", sa.Integer, default=0),
        sa.Column("total_test_drives", sa.Integer, default=0),
        sa.Column("total_loan_inquiries", sa.Integer, default=0),
        sa.Column("revisit_count", sa.Integer, default=0),
        sa.Column("scored_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ollama_used", sa.Boolean, default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_cis_dealer_score", "customer_intent_scores", ["dealer_id", "intent_score"])
    op.create_index("ix_cis_user_dealer", "customer_intent_scores", ["user_id", "dealer_id"], unique=True)


def downgrade() -> None:
    op.drop_table("customer_intent_scores")
    op.drop_table("customer_activities")
    op.execute("DROP TYPE IF EXISTS leadgrade")
    op.execute("DROP TYPE IF EXISTS activitytype")
