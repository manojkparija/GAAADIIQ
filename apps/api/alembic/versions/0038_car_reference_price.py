"""cars.reference_price — a human-sourced figure to check entered prices against

UAT asked for entered prices to be flagged when they differ significantly from
the market. The obvious implementation is to look the market price up, and that
is exactly what this must not do without a real source: a figure produced by a
model or a heuristic is indistinguishable from a checked one at the point it is
read, and would be believed. The same reasoning `services/credit_bureau.py`
follows by raising rather than returning a plausible score.

So the reference is entered by a person, alongside where they got it and the
day they looked. Three columns rather than one, because a price with no source
and no date cannot be judged: a figure from the OEM site this morning and one
someone half-remembers from last year are not the same evidence, and the
comparison is only worth showing when the reader can tell which they have.

Nothing is inferred. A model with no reference is simply not checked, and the
UI says so rather than implying agreement.

Revision ID: 0038
Revises: 0037
"""

import sqlalchemy as sa

from alembic import op

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # Guarded the same way as 0037: the marketplace tables were created by
    # hand-run SQL rather than by this chain, so the database may already
    # differ from what the migration history claims.
    if "cars" not in inspector.get_table_names():
        return

    existing = {c["name"] for c in inspector.get_columns("cars")}

    if "reference_price" not in existing:
        op.add_column("cars", sa.Column("reference_price", sa.Numeric(12, 2), nullable=True))
    if "reference_price_source" not in existing:
        op.add_column("cars", sa.Column("reference_price_source", sa.String(255), nullable=True))
    if "reference_price_checked_on" not in existing:
        op.add_column("cars", sa.Column("reference_price_checked_on", sa.Date(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "cars" not in inspector.get_table_names():
        return

    existing = {c["name"] for c in inspector.get_columns("cars")}
    for column in (
        "reference_price_checked_on",
        "reference_price_source",
        "reference_price",
    ):
        if column in existing:
            op.drop_column("cars", column)
