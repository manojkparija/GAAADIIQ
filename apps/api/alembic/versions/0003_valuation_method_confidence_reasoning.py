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


def upgrade() -> None:
    op.add_column("listings", sa.Column("ai_method", sa.String(64), nullable=True))
    op.add_column("listings", sa.Column("ai_confidence", sa.String(16), nullable=True))
    op.add_column("listings", sa.Column("ai_reasoning", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("listings", "ai_reasoning")
    op.drop_column("listings", "ai_confidence")
    op.drop_column("listings", "ai_method")
