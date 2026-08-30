"""Upcoming cars, as data an admin can edit.

WHY

The New Cars page's "Upcoming Cars" strip was a hardcoded array of five entries
in the Angular component, with the expected date as free text ("Q3 2026") and
nothing that ever removed one. A car stayed under "Upcoming" after it launched,
and correcting that took a code change and a deploy.

Reported with four of the five already on sale.

TWO WAYS TO STOP BEING UPCOMING

expected_on is a DATE, not a quarter string, so "is this still upcoming?" is a
comparison rather than a reading. The quarter is still what the page shows —
the industry announces in quarters — but it is derived from the date.

launched_at covers the case a date cannot: a car often arrives before its
announced window closes. The Tata Sierra EV was on sale with a month still to
run on its own "Q3 2026", and waiting for the date would have kept it on the
strip throughout.

Neither is a delete. A launched model is a real thing that was announced, and
the row is worth keeping once the page stops showing it.

PRICES ARE NULLABLE

An announcement routinely names a car and a quarter and no price. NUMERIC, like
cars.ex_showroom_price, because a float rounds money.

Revision ID: 0047
Revises: 0046
"""
import sqlalchemy as sa

from alembic import op

revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "upcoming_cars",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("make", sa.String(length=100), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("expected_on", sa.Date(), nullable=False),
        sa.Column("launched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expected_price_min", sa.Numeric(12, 2), nullable=True),
        sa.Column("expected_price_max", sa.Numeric(12, 2), nullable=True),
        sa.Column("body_type", sa.String(length=50), nullable=True),
        sa.Column("fuel_type", sa.String(length=50), nullable=True),
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_upcoming_cars_expected_on", "upcoming_cars", ["expected_on"])


def downgrade() -> None:
    op.drop_index("ix_upcoming_cars_expected_on", table_name="upcoming_cars")
    op.drop_table("upcoming_cars")
