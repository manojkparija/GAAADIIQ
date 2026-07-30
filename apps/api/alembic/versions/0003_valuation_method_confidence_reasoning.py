"""add ai_method, ai_confidence, ai_reasoning to listings

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-16
"""
import sqlalchemy as sa

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def _listing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {c["name"] for c in inspector.get_columns("listings")}


def upgrade() -> None:
    # These three columns were later back-ported into 0001, so on a fresh
    # database they already exist by the time this migration runs and the
    # ALTER aborted the whole chain with DuplicateColumnError. Adding only
    # what is missing keeps both cases working: a fresh database (columns
    # already present) and an older one migrated before the back-port.
    existing = _listing_columns()
    for name, type_ in (
        ("ai_method", sa.String(64)),
        ("ai_confidence", sa.String(16)),
        ("ai_reasoning", sa.Text()),
    ):
        if name not in existing:
            op.add_column("listings", sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    existing = _listing_columns()
    for name in ("ai_reasoning", "ai_confidence", "ai_method"):
        if name in existing:
            op.drop_column("listings", name)
