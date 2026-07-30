"""Voice diagnosis persistence + maintenance history.

BR-DB-01 voice_transcripts
BR-DB-02 diagnosis_conversations
BR-DB-04 diagnosis_audit_events
BR-IR-07 vehicle_diagnoses.maintenance_history

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-25
"""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── BR-IR-07: reported service history ────────────────────────────────
    op.add_column(
        "vehicle_diagnoses",
        sa.Column("maintenance_history", sa.JSON(), nullable=True),
    )

    # ── BR-DB-02: conversations ───────────────────────────────────────────
    op.create_table(
        "diagnosis_conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), onupdate=sa.text("now()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("diagnosis_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("language", sa.String(10), nullable=False, server_default="en-IN"),
        sa.Column("stt_engine", sa.String(30), nullable=True),
        sa.Column("language_auto_detected", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("extracted_vehicle_info", sa.JSON(), nullable=True),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("turn_count", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["diagnosis_id"], ["vehicle_diagnoses.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_diag_conv_user", "diagnosis_conversations", ["user_id"])
    op.create_index("ix_diag_conv_diagnosis", "diagnosis_conversations", ["diagnosis_id"])

    # ── BR-DB-01: transcripts (text only — audio is never stored) ─────────
    op.create_table(
        "voice_transcripts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), onupdate=sa.text("now()"), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("role", sa.String(16), nullable=False, server_default="user"),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("language", sa.String(10), nullable=False, server_default="en-IN"),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("stt_engine", sa.String(30), nullable=True),
        sa.Column("step", sa.String(32), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["conversation_id"], ["diagnosis_conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_voice_tr_conversation", "voice_transcripts", ["conversation_id"])
    op.create_index("ix_voice_tr_user", "voice_transcripts", ["user_id"])

    # ── BR-DB-04: append-only audit trail ─────────────────────────────────
    # SET NULL rather than CASCADE on both FKs: the trail must outlive the
    # data it describes, or there is no proof erasure was carried out.
    op.create_table(
        "diagnosis_audit_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("event_type", sa.String(40), nullable=False),
        sa.Column("consent_version", sa.Integer(), nullable=True),
        sa.Column("language", sa.String(10), nullable=True),
        sa.Column("detail", sa.JSON(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["conversation_id"], ["diagnosis_conversations.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_diag_audit_user", "diagnosis_audit_events", ["user_id"])
    op.create_index("ix_diag_audit_conversation", "diagnosis_audit_events", ["conversation_id"])
    op.create_index("ix_diag_audit_type", "diagnosis_audit_events", ["event_type"])
    op.create_index("ix_diag_audit_occurred", "diagnosis_audit_events", ["occurred_at"])


def downgrade() -> None:
    op.drop_table("diagnosis_audit_events")
    op.drop_table("voice_transcripts")
    op.drop_table("diagnosis_conversations")
    op.drop_column("vehicle_diagnoses", "maintenance_history")
