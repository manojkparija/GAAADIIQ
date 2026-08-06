"""Add vehicle_media.media_bucket — which catalogue surface an image serves.

An admin uploading a photograph chooses whether it belongs on the New Cars
pages, the Used Cars pages, or both. Until now the upload form captured only
the vehicle's identity, so a stored image had no route to any customer-facing
surface.

Plain text rather than the listings.listing_type enum: that type is exactly
{new, used} and describes a single advert, whereas this column also needs
"both" — the usual case for a manufacturer photograph. Widening the enum would
migrate a type that adverts depend on.

Nullable, and readers treat NULL as "both", so images stored before this column
existed stay visible rather than vanishing from every surface.

Revision ID: 0015
Revises: 0014
Create Date: 2026-08-06 09:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        op.execute(
            "ALTER TABLE vehicle_media ADD COLUMN IF NOT EXISTS media_bucket VARCHAR(8)"
        )
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_vehicle_media_media_bucket "
            "ON vehicle_media (media_bucket)"
        )
    else:
        try:
            op.add_column(
                "vehicle_media",
                sa.Column("media_bucket", sa.String(8), nullable=True),
            )
            op.create_index(
                "ix_vehicle_media_media_bucket", "vehicle_media", ["media_bucket"]
            )
        except Exception:  # noqa: BLE001 — column/index may already exist
            pass


def downgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS ix_vehicle_media_media_bucket")
        op.execute("ALTER TABLE vehicle_media DROP COLUMN IF EXISTS media_bucket")
    else:
        try:
            op.drop_index("ix_vehicle_media_media_bucket", table_name="vehicle_media")
            op.drop_column("vehicle_media", "media_bucket")
        except Exception:  # noqa: BLE001 — may already be gone
            pass
