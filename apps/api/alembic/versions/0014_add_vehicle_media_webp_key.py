"""Add the missing vehicle_media.webp_key column.

The model has declared webp_key since the WebP derivative work, but no
migration ever created it, so the column was absent on any database built from
migrations alone. Every query that selected the full VehicleMedia model — the
admin gallery among them — failed with:

    UndefinedColumnError: column vehicle_media.webp_key does not exist

which surfaced as a bare 500 from /media-admin/dealer-images.

Revision ID: 0014
Revises: 0013
Create Date: 2026-08-05 10:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        # IF NOT EXISTS so the migration is safe on databases where the column
        # was already added by hand to stop the bleeding.
        op.execute(
            "ALTER TABLE vehicle_media ADD COLUMN IF NOT EXISTS webp_key VARCHAR(512)"
        )
    else:
        try:
            op.add_column(
                "vehicle_media",
                sa.Column("webp_key", sa.String(512), nullable=True),
            )
        except Exception:  # noqa: BLE001 — column may already exist
            pass


def downgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE vehicle_media DROP COLUMN IF EXISTS webp_key")
    else:
        try:
            op.drop_column("vehicle_media", "webp_key")
        except Exception:  # noqa: BLE001 — column may already be gone
            pass
