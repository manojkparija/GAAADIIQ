"""Add the five columns production is missing but the models declare.

The drift report at startup has been naming these on every boot:

    price_alerts is missing: updated_at
    test_drive_bookings is missing: preferred_date, preferred_time
    reviews is missing: body, is_verified

They are not cosmetic. A SELECT built from a model lists every column it
declares, so a query against any of these three tables fails outright on
Postgres — a 500 for anyone loading a review, a price alert, or a test-drive
booking. They are missing because this schema was reconciled by hand; now that
migrations run on deploy, the repair belongs here.

Every column is added nullable or with a default, so no existing row needs a
value invented for it.

Revision ID: 0027
Revises: 0026
"""
from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Guarded like its neighbours: this database has been reconciled by hand
    # more than once, and a migration that assumes its own starting state is
    # how a deploy stops.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'price_alerts' AND column_name = 'updated_at'
            ) THEN
                -- DEFAULT now() rather than NULL: TimestampMixin declares this
                -- NOT NULL, and a row that predates the column has no more
                -- truthful timestamp available than the moment it acquired one.
                ALTER TABLE price_alerts
                    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'test_drive_bookings' AND column_name = 'preferred_date'
            ) THEN
                ALTER TABLE test_drive_bookings ADD COLUMN preferred_date DATE NULL;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'test_drive_bookings' AND column_name = 'preferred_time'
            ) THEN
                ALTER TABLE test_drive_bookings ADD COLUMN preferred_time TIME NULL;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'reviews' AND column_name = 'body'
            ) THEN
                ALTER TABLE reviews ADD COLUMN body TEXT NULL;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'reviews' AND column_name = 'is_verified'
            ) THEN
                -- false, not true. A review nobody has checked is not verified,
                -- and defaulting the other way would mark every existing review
                -- as vouched for by nobody.
                ALTER TABLE reviews
                    ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT false;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE reviews DROP COLUMN IF EXISTS is_verified;")
    op.execute("ALTER TABLE reviews DROP COLUMN IF EXISTS body;")
    op.execute("ALTER TABLE test_drive_bookings DROP COLUMN IF EXISTS preferred_time;")
    op.execute("ALTER TABLE test_drive_bookings DROP COLUMN IF EXISTS preferred_date;")
    op.execute("ALTER TABLE price_alerts DROP COLUMN IF EXISTS updated_at;")
