"""Teach `lead_source` about `upcoming`.

The Upcoming Cars strip's "Notify Me" button recorded nothing at all — it
wrote a key to the reader's own localStorage, so "We will notify you when this
car launches" was a promise with no record behind it anywhere. It now records
a verified lead like every other enquiry, which needs a label saying where the
buyer was standing.

THE THIRD TIME, SO FOLLOWING THE PATTERN THAT STOPPED THE SECOND

Migration 0036 added a missing `notification_type` label after a production
failure; 0049 added a missing `whatsapp_template` label after the same class of
failure one step further along the same flow. Both were Python enums that had
grown a member the Postgres type never got, and both surfaced as:

    InvalidTextRepresentationError: invalid input value for enum ...

This migration exists so `upcoming` never reaches that point.
tests/test_migrations_match_models.py compares every ORM enum's members against
the labels the migrated database actually has, and fails on this file's
absence — the check is the thing that stops a fourth, not this file.

Safe on a database in any state: type missing, type present but short a label,
or already correct. ALTER TYPE ... ADD VALUE runs inside a transaction from
PostgreSQL 12, and the new label is not *used* here.
"""
import sqlalchemy as sa

from alembic import op

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None

# The labels the ORM can produce, from models/car_lead.py. Kept in step by the
# enum comparison in tests/test_migrations_match_models.py.
_LABELS = [
    "offers_cta",
    "car_detail",
    "variants",
    "upcoming",
]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        # SQLite has no enum types; the column is plain text there and accepts
        # every label already. That is exactly why this class of fault reaches
        # production unseen from a green SQLite run.
        return

    labels = ", ".join(f"'{v}'" for v in _LABELS)
    # The type may not exist at all: some of production's tables came from the
    # hand-run schema_setup_batch*.sql files rather than the migration chain.
    # ADD VALUE IF NOT EXISTS guards the value, not the type — that reading is
    # what broke migration 0045 and blocked every deploy behind it.
    op.execute(
        sa.text(
            f"""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lead_source') THEN
                    CREATE TYPE lead_source AS ENUM ({labels});
                END IF;
            END
            $$;
            """
        )
    )

    for value in _LABELS:
        op.execute(sa.text(f"ALTER TYPE lead_source ADD VALUE IF NOT EXISTS '{value}'"))


def downgrade() -> None:
    # Labels cannot be removed from a PostgreSQL enum without recreating the
    # type, and dropping `upcoming` would orphan every lead already recorded
    # against it. Deliberately a no-op, as in 0036 and 0049.
    pass
