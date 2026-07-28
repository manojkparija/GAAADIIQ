"""add password_reset_token and password_reset_expires to users

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-16
"""
import sqlalchemy as sa

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def _user_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {c["name"] for c in inspector.get_columns("users")}


def upgrade() -> None:
    # Add only what is missing. A database whose alembic_version was stamped
    # ahead of its real schema has to replay these migrations, and a plain
    # ALTER would abort the replay on any column that happens to be present.
    existing = _user_columns()
    for name, type_ in (
        ("password_reset_token", sa.Text()),
        ("password_reset_expires", sa.DateTime(timezone=True)),
    ):
        if name not in existing:
            op.add_column("users", sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    existing = _user_columns()
    for name in ("password_reset_expires", "password_reset_token"):
        if name in existing:
            op.drop_column("users", name)
