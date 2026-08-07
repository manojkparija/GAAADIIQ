"""Add the timestamp columns cars and listings are missing.

    column cars.updated_at does not exist

The third column this deployment has been missing in as many attempts, and the
reason is worth stating: 0017 and 0018 reconciled the columns each model
declares in its own class body, and overlooked the two every model inherits
from TimestampMixin. created_at survived because the hand-written SQL happened
to include it; updated_at did not.

Every SELECT the ORM issues names both, so a table missing either is a table no
query can read — the same total failure as a missing price or fuel_type, from
the same cause.

Applied to both tables rather than only the one that failed. listings has not
been observed failing on it, but nothing established that it has these columns
either, and the cost of adding a column that already exists is nothing.

Revision ID: 0019
Revises: 0018
Create Date: 2026-08-07 13:00:00.000000

"""
from __future__ import annotations

from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None

_TABLES = ("cars", "listings")

# NOT NULL with a server default, matching TimestampMixin: existing rows get
# the current time, which is wrong but harmless — a created_at nobody recorded
# cannot be recovered, and leaving the column nullable would contradict the
# model on every row inserted afterwards.
_COLUMNS = (
    ("created_at", "TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()"),
    ("updated_at", "TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()"),
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for table in _TABLES:
        for column, definition in _COLUMNS:
            op.execute(
                f"""
                DO $$
                BEGIN
                    IF to_regclass('public.{table}') IS NOT NULL THEN
                        ALTER TABLE {table}
                            ADD COLUMN IF NOT EXISTS {column} {definition};
                    END IF;
                END $$;
                """
            )


def downgrade() -> None:
    # Dropping these would break every query again, for the same reason.
    pass
