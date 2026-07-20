"""Add vehicle_diagnoses table.

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-20
"""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vehicle_diagnoses",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), onupdate=sa.text("now()"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("manufacturer", sa.String(100), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("variant", sa.String(100), nullable=True),
        sa.Column("model_year", sa.Integer(), nullable=False),
        sa.Column("fuel_type", sa.String(30), nullable=False),
        sa.Column("transmission", sa.String(30), nullable=False),
        sa.Column("odometer_km", sa.Integer(), nullable=True),
        sa.Column("problem_description", sa.Text(), nullable=False),
        sa.Column("warning_lights", postgresql.JSONB(), nullable=True),
        sa.Column("when_occurs", postgresql.JSONB(), nullable=True),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("image_urls", postgresql.JSONB(), nullable=True),
        sa.Column("audio_url", sa.String(500), nullable=True),
        sa.Column("video_url", sa.String(500), nullable=True),
        sa.Column("preliminary_diagnosis", sa.Text(), nullable=True),
        sa.Column("possible_causes", postgresql.JSONB(), nullable=True),
        sa.Column("repair_complexity", sa.String(30), nullable=True),
        sa.Column("cost_min_inr", sa.Integer(), nullable=True),
        sa.Column("cost_max_inr", sa.Integer(), nullable=True),
        sa.Column("repair_time_estimate", sa.String(100), nullable=True),
        sa.Column("safe_to_drive", sa.Boolean(), nullable=True),
        sa.Column("risk_level", sa.String(20), nullable=True),
        sa.Column("recommended_steps", postgresql.JSONB(), nullable=True),
        sa.Column("diy_fixes", postgresql.JSONB(), nullable=True),
        sa.Column("immediate_service_required", sa.Boolean(), nullable=True),
        sa.Column("preventive_maintenance", postgresql.JSONB(), nullable=True),
        sa.Column("retrieved_sources", postgresql.JSONB(), nullable=True),
        sa.Column("ollama_used", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("analysis_confidence", sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_vehicle_diagnoses_user_id", "vehicle_diagnoses", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_vehicle_diagnoses_user_id", table_name="vehicle_diagnoses")
    op.drop_table("vehicle_diagnoses")
