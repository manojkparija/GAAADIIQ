"""Add the four dealers columns production is missing.

Production raised this on a live request:

    UndefinedColumnError: column dealers.city does not exist
    [SQL: SELECT dealers.user_id, dealers.business_name, dealers.city,
          dealers.state, dealers.gst_number, dealers.is_verified,
          dealers.rating, ... FROM dealers WHERE dealers.user_id = $1::UUID]

Every dealer-profile lookup 500s, so the dealer dashboard is unusable for
anyone who has one.

WHY THE COLUMNS ARE ABSENT

This is the two-sources-of-truth trap in CLAUDE.md, caught in the act.
`dealers` is created in two places that disagree:

  * alembic/versions/0001_initial_schema.py — creates it WITH city, state,
    gst_number and rating. This matches models/dealer.py.
  * schema_setup_batch1_enums_and_core.sql — creates it WITHOUT them, and with
    business_type and license_number instead.

Production was built from the SQL file and then stamped, so 0001's version of
the table never ran. The ORM has been selecting four columns that were never
created. Nothing failed until a request actually loaded a Dealer.

The two extra columns the SQL file added (business_type, license_number) are
left alone: the ORM does not know about them, so they cost nothing, and
dropping columns that might hold data is not something a repair migration
should do on its own initiative.

Revision ID: 0028
Revises: 0027
"""
from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Guarded, like 0027: this database has been reconciled by hand more than
    # once, and any environment built from the migrations rather than the SQL
    # file already has these. A migration that assumes its own starting state
    # is how a deploy stops.
    #
    # All four are nullable in the model, so no existing dealer needs a value
    # invented for it — and inventing a city for a dealer would be worse than
    # leaving it blank, since it feeds buyer-facing search.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'dealers' AND column_name = 'city'
            ) THEN
                ALTER TABLE dealers ADD COLUMN city VARCHAR(100) NULL;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'dealers' AND column_name = 'state'
            ) THEN
                ALTER TABLE dealers ADD COLUMN state VARCHAR(100) NULL;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'dealers' AND column_name = 'gst_number'
            ) THEN
                ALTER TABLE dealers ADD COLUMN gst_number VARCHAR(20) NULL;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'dealers' AND column_name = 'rating'
            ) THEN
                -- NUMERIC(3,2) to match the model: a rating is 0.00-9.99, and a
                -- float would make 4.35 unrepresentable and comparisons wrong.
                ALTER TABLE dealers ADD COLUMN rating NUMERIC(3, 2) NULL;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE dealers DROP COLUMN IF EXISTS rating;")
    op.execute("ALTER TABLE dealers DROP COLUMN IF EXISTS gst_number;")
    op.execute("ALTER TABLE dealers DROP COLUMN IF EXISTS state;")
    op.execute("ALTER TABLE dealers DROP COLUMN IF EXISTS city;")
