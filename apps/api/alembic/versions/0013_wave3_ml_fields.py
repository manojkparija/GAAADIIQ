"""Add WAVE 3 ML fields to vehicle_media table (embeddings, OCR, safety).

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-02 09:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    # Add WAVE 3 ML fields to vehicle_media table (idempotent)
    ml_fields = [
        ("embedding_vector", "JSONB", sa.Column("embedding_vector", sa.JSON(), nullable=True)),
        ("ocr_text", "TEXT", sa.Column("ocr_text", sa.Text(), nullable=True)),
        ("ocr_confidence", "FLOAT", sa.Column("ocr_confidence", sa.Float(), nullable=True)),
        ("ocr_entities", "JSONB", sa.Column("ocr_entities", sa.JSON(), nullable=True)),
        ("nsfw_score", "FLOAT", sa.Column("nsfw_score", sa.Float(), nullable=True)),
        ("license_plate_detected", "BOOLEAN", sa.Column("license_plate_detected", sa.Boolean(), nullable=True)),
        ("license_plate_bbox", "JSONB", sa.Column("license_plate_bbox", sa.JSON(), nullable=True)),
        ("safety_metadata", "JSONB", sa.Column("safety_metadata", sa.JSON(), nullable=True)),
    ]

    if is_postgres:
        # Add columns if they don't exist
        for col_name, col_type, _ in ml_fields:
            op.execute(f"ALTER TABLE vehicle_media ADD COLUMN IF NOT EXISTS {col_name} {col_type}")

        # Create indexes if they don't exist
        op.execute("""
            CREATE INDEX IF NOT EXISTS ix_vehicle_media_ocr_confidence
            ON vehicle_media (ocr_confidence)
        """)
        op.execute("""
            CREATE INDEX IF NOT EXISTS ix_vehicle_media_nsfw_score
            ON vehicle_media (nsfw_score)
        """)
        op.execute("""
            CREATE INDEX IF NOT EXISTS ix_vehicle_media_license_plate_detected
            ON vehicle_media (license_plate_detected)
        """)
    else:
        # SQLite: add columns one by one (may fail silently if already exists)
        try:
            for _, _, column in ml_fields:
                op.add_column("vehicle_media", column)
        except Exception:
            pass  # Column may already exist

        # Create indexes if they don't exist
        op.create_index("ix_vehicle_media_ocr_confidence", "vehicle_media", ["ocr_confidence"], if_not_exists=True)
        op.create_index("ix_vehicle_media_nsfw_score", "vehicle_media", ["nsfw_score"], if_not_exists=True)
        op.create_index("ix_vehicle_media_license_plate_detected", "vehicle_media", ["license_plate_detected"], if_not_exists=True)


def downgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        # Drop indexes
        op.execute("DROP INDEX IF EXISTS ix_vehicle_media_license_plate_detected")
        op.execute("DROP INDEX IF EXISTS ix_vehicle_media_nsfw_score")
        op.execute("DROP INDEX IF EXISTS ix_vehicle_media_ocr_confidence")

        # Drop columns
        columns_to_drop = [
            "safety_metadata",
            "license_plate_bbox",
            "license_plate_detected",
            "nsfw_score",
            "ocr_entities",
            "ocr_confidence",
            "ocr_text",
            "embedding_vector",
        ]
        for col in columns_to_drop:
            op.execute(f"ALTER TABLE vehicle_media DROP COLUMN IF EXISTS {col}")
    else:
        # SQLite
        op.drop_index("ix_vehicle_media_license_plate_detected", table_name="vehicle_media")
        op.drop_index("ix_vehicle_media_nsfw_score", table_name="vehicle_media")
        op.drop_index("ix_vehicle_media_ocr_confidence", table_name="vehicle_media")

        for col_name in [
            "safety_metadata",
            "license_plate_bbox",
            "license_plate_detected",
            "nsfw_score",
            "ocr_entities",
            "ocr_confidence",
            "ocr_text",
            "embedding_vector",
        ]:
            op.drop_column("vehicle_media", col_name)
