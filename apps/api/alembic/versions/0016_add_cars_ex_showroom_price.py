"""Add cars.ex_showroom_price — the manufacturer price for a catalogue model.

The cars table described a model's identity and specification but carried no
price, so the only prices in the system belonged to listings: one seller's
asking price for one vehicle. That is the right model for Used Cars, where a
price is a negotiating position attached to an advert, and the wrong one for
New Cars, where a model has a single manufacturer price whether or not anyone
has advertised it.

Ex-showroom rather than on-road: on-road price varies by state and by the
registration, insurance and accessories a buyer chooses, so it cannot be a
single stored number per model. Ex-showroom is the figure manufacturers
publish and the one buyers compare across models.

NUMERIC(12,2) matches listings.price. Indian car prices run to eight figures,
so a 12-digit precision leaves room without inviting the rounding that a
float would introduce into money.

Nullable: the catalogue already holds models whose price nobody has entered
yet, and a NULL says "not priced" honestly. Readers must not show an unpriced
model as costing zero.

Revision ID: 0016
Revises: 0015
Create Date: 2026-08-07 10:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        op.execute(
            "ALTER TABLE cars ADD COLUMN IF NOT EXISTS "
            "ex_showroom_price NUMERIC(12, 2)"
        )
    else:
        try:
            op.add_column(
                "cars",
                sa.Column("ex_showroom_price", sa.Numeric(12, 2), nullable=True),
            )
        except Exception:  # noqa: BLE001 — column may already exist
            pass


def downgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE cars DROP COLUMN IF EXISTS ex_showroom_price")
    else:
        try:
            op.drop_column("cars", "ex_showroom_price")
        except Exception:  # noqa: BLE001 — may already be gone
            pass
