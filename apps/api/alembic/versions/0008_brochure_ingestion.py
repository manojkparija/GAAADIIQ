"""Brochure ingestion: jobs, extracted images, extracted vehicles.

pdf_ingestion_jobs   one uploaded brochure and how it processed
vehicle_media        one extracted image and its storage key
extracted_vehicles   one vehicle the AI found, pending admin review

Revision ID: 0008
Revises: 0007
Create Date: 2026-07-27
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # create_type=False on the second use: PostgreSQL creates the enum with the
    # first table that references it, and creating it again aborts the
    # migration with "type already exists".
    ingestion_status = sa.Enum(
        "pending", "processing", "completed", "failed", name="ingestion_status"
    )
    media_kind = sa.Enum(
        "unknown", "exterior", "interior", "colour_swatch", "feature", "logo",
        name="media_kind",
    )

    op.create_table(
        "pdf_ingestion_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("source_pdf_name", sa.String(500), nullable=False),
        sa.Column("source_pdf_key", sa.String(512), nullable=True),
        sa.Column("file_size_bytes", sa.Integer(), nullable=True),
        sa.Column("status", ingestion_status, nullable=False, server_default="pending"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("page_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("image_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("vehicle_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ai_engine", sa.String(60), nullable=True),
        # SET NULL, not CASCADE: the ingestion record is provenance and must
        # outlive the admin account that created it.
        sa.Column(
            "uploaded_by", sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_pdf_jobs_status", "pdf_ingestion_jobs", ["status"])
    op.create_index("ix_pdf_jobs_uploaded_by", "pdf_ingestion_jobs", ["uploaded_by"])

    op.create_table(
        "vehicle_media",
        sa.Column("id", sa.Uuid(), primary_key=True),
        # Unique: the same key must never map to two rows, or deleting one
        # would break the other.
        sa.Column("storage_key", sa.String(512), nullable=False, unique=True),
        sa.Column("content_type", sa.String(100), nullable=False, server_default="image/png"),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("source_pdf_name", sa.String(500), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("kind", media_kind, nullable=False, server_default="unknown"),
        sa.Column("make", sa.String(120), nullable=True),
        sa.Column("model", sa.String(120), nullable=True),
        sa.Column("variant", sa.String(160), nullable=True),
        sa.Column("colour", sa.String(80), nullable=True),
        sa.Column("phash", sa.String(64), nullable=True),
        sa.Column(
            "job_id", sa.Uuid(),
            sa.ForeignKey("pdf_ingestion_jobs.id", ondelete="CASCADE"), nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_vehicle_media_make", "vehicle_media", ["make"])
    op.create_index("ix_vehicle_media_model", "vehicle_media", ["model"])
    op.create_index("ix_vehicle_media_phash", "vehicle_media", ["phash"])
    op.create_index("ix_vehicle_media_job", "vehicle_media", ["job_id"])
    op.create_index("ix_vehicle_media_created", "vehicle_media", ["created_at"])

    op.create_table(
        "extracted_vehicles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("make", sa.String(120), nullable=True),
        sa.Column("model", sa.String(120), nullable=True),
        sa.Column("variant", sa.String(160), nullable=True),
        sa.Column("model_year", sa.Integer(), nullable=True),
        sa.Column("price_inr", sa.Integer(), nullable=True),
        sa.Column("fuel_type", sa.String(40), nullable=True),
        sa.Column("transmission", sa.String(40), nullable=True),
        sa.Column("body_type", sa.String(40), nullable=True),
        sa.Column("colours", sa.JSON(), nullable=True),
        sa.Column("specs", sa.JSON(), nullable=True),
        sa.Column("features", sa.JSON(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0"),
        sa.Column("review_status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column(
            "job_id", sa.Uuid(),
            sa.ForeignKey("pdf_ingestion_jobs.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_extracted_vehicles_job", "extracted_vehicles", ["job_id"])


def downgrade() -> None:
    op.drop_table("extracted_vehicles")
    op.drop_table("vehicle_media")
    op.drop_table("pdf_ingestion_jobs")
    # Enums are database-level objects and outlive their tables, so they must
    # be dropped explicitly or a re-run of upgrade() fails.
    sa.Enum(name="media_kind").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="ingestion_status").drop(op.get_bind(), checkfirst=True)
