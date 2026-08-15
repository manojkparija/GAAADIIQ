"""Make `notification_type` exist, and know about `job_offer`.

Dispatching a job to a mechanic 0.02 km away returned 500 in production:

    asyncpg.exceptions.UndefinedObjectError: type "notification_type" does not exist
    [SQL: INSERT INTO notifications (user_id, type, ...) VALUES ($1::UUID, $2::notification_type, ...)]
    [parameters: (UUID(...), 'job_offer', 'New job 0.02 km away', ...)]

Two separate faults, and fixing either alone leaves the flow broken:

1. The type is absent from that database. `notifications` exists there, so the
   table came from somewhere other than migration 0001 — the same
   schema-in-two-places drift that `listing_id` came from. SQLAlchemy renders
   the bind as `$2::notification_type` regardless, and the cast is what fails.

2. `job_offer` was added to the Python `NotificationType` in the marketplace
   work but never to the Postgres enum, which 0001 created with seven labels
   and nobody has touched since. So even where the type does exist, this insert
   fails — with InvalidTextRepresentation instead, which is a different error
   for the same missing thing.

Written to be safe on a database in any of those states: type missing, type
present but short a label, or already correct.

ALTER TYPE ... ADD VALUE runs inside a transaction from PostgreSQL 12; the new
label may not be *used* in the same transaction, which this does not do.
"""
import sqlalchemy as sa

from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None

# The labels the ORM can produce. Kept in step with models/notification.py by
# tests/test_notification_enum.py, which fails when the two drift — this bug
# was a member added on one side only, and nothing noticed for a whole feature.
_LABELS = [
    "booking_received",
    "booking_confirmed",
    "booking_cancelled",
    "loan_inquiry_received",
    "price_drop",
    "listing_viewed",
    "job_offer",
    "system",
]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        # SQLite has no enum types; the column is plain text there and every
        # label is already acceptable. (CI runs on SQLite, which is exactly why
        # this class of fault reaches production unseen.)
        return

    labels = ", ".join(f"'{v}'" for v in _LABELS)
    op.execute(
        sa.text(
            f"""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type') THEN
                    EXECUTE 'CREATE TYPE notification_type AS ENUM ({labels})';
                END IF;
            END
            $$;
            """
        )
    )

    # Add anything the type is missing. IF NOT EXISTS makes each one a no-op
    # when already present, so this is safe to re-run and safe on a database
    # that has some of them.
    for value in _LABELS:
        op.execute(sa.text(f"ALTER TYPE notification_type ADD VALUE IF NOT EXISTS '{value}'"))

    # If the column is text rather than the enum — which is how a database
    # without the type could still have the table — convert it, but only when
    # every value already stored is a valid label. Anything else is a decision
    # a migration should not make alone, so it says so and stops.
    op.execute(
        sa.text(
            """
            DO $$
            DECLARE
                col_type text;
                bad_count bigint;
            BEGIN
                SELECT data_type INTO col_type
                  FROM information_schema.columns
                 WHERE table_name = 'notifications' AND column_name = 'type';

                IF col_type IS NULL THEN
                    RETURN;                      -- no such table here
                END IF;

                IF col_type = 'USER-DEFINED' THEN
                    RETURN;                      -- already the enum
                END IF;

                SELECT count(*) INTO bad_count
                  FROM notifications
                 WHERE type IS NOT NULL
                   AND type NOT IN (SELECT unnest(enum_range(NULL::notification_type))::text);

                IF bad_count > 0 THEN
                    RAISE WARNING
                      'notifications.type left as % — % row(s) hold values that are not notification_type labels',
                      col_type, bad_count;
                    RETURN;
                END IF;

                ALTER TABLE notifications
                    ALTER COLUMN type TYPE notification_type
                    USING type::notification_type;
            END
            $$;
            """
        )
    )


def downgrade() -> None:
    # Labels cannot be removed from a PostgreSQL enum without recreating the
    # type, and dropping `job_offer` would orphan every dispatch notification
    # already stored. Deliberately a no-op.
    pass
