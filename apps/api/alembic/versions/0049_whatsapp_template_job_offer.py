"""Teach `whatsapp_template` about `job_offer`.

Broadcasting a request to a mechanic 0.02 km away failed in production:

    asyncpg.exceptions.InvalidTextRepresentationError: invalid input value for
    enum whatsapp_template: "job_offer"
    [SQL: INSERT INTO whatsapp_messages (to_phone, template, ...)
     VALUES ($1::VARCHAR, $2::whatsapp_template, ...)]
    [parameters: ('9199...', 'job_offer', '{"reference": "SR-92A19C",
     "distance_km": "0.02", ...}')]

Migration 0025 created the type with three labels. `job_offer` was added to the
Python `WhatsAppTemplate` during the dispatch work and never to the Postgres
enum, so every broadcast that reached the notify step died on the cast — after
the service request row had been written, which is why the customer saw a
failure against a job that existed.

THIS IS THE SECOND TIME

Migration 0036 fixed the identical fault for `notification_type`, in the same
dispatch, quoting the same "0.02 km away" line. It repaired the enum it had
been shown and nobody checked the other enum in the same INSERT path. So the
flow moved one step further and stopped again, on the same class of bug, in a
different type.

What stops a third: tests/test_migrations_match_models.py now compares every
ORM enum's members against the labels the migrated database actually has,
rather than only tables and columns. That test fails on this migration's
absence, so this file is not the fix on its own -- the check is.

Safe on a database in any state: type missing, type present but short a label,
or already correct. ALTER TYPE ... ADD VALUE runs inside a transaction from
PostgreSQL 12; the new label is not *used* here.
"""
import sqlalchemy as sa

from alembic import op

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None

# The labels the ORM can produce, from models/whatsapp_message.py. Kept in step
# by the enum comparison in tests/test_migrations_match_models.py.
_LABELS = [
    "payment_receipt",
    "mechanic_assigned",
    "service_request_raised",
    "job_offer",
]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        # SQLite has no enum types; the column is plain text there and accepts
        # every label already. That is exactly why this class of fault reaches
        # production unseen from a green SQLite run.
        return

    labels = ", ".join(f"'{v}'" for v in _LABELS)
    # The type may not exist at all: production's marketplace tables came from
    # the hand-run schema_setup_batch*.sql files rather than the migration
    # chain. ADD VALUE IF NOT EXISTS guards the value, not the type — that
    # reading is what broke migration 0045 and blocked every deploy behind it.
    op.execute(
        sa.text(
            f"""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'whatsapp_template') THEN
                    CREATE TYPE whatsapp_template AS ENUM ({labels});
                END IF;
            END
            $$;
            """
        )
    )

    for value in _LABELS:
        op.execute(sa.text(f"ALTER TYPE whatsapp_template ADD VALUE IF NOT EXISTS '{value}'"))


def downgrade() -> None:
    # Labels cannot be removed from a PostgreSQL enum without recreating the
    # type, and dropping `job_offer` would orphan every broadcast message
    # already stored. Deliberately a no-op, as in 0036.
    pass
