"""The trims a model is sold in, as data rather than as a hardcoded map.

What a buyer asks after choosing a model is which trim to buy, and that
question is entirely about the differences: what each costs and what each gives
you. That lived in NEW_CAR_META, a literal in the Angular car detail page
covering seven models. Every other model showed no variants at all, and no
admin action could change it.

Drafts are part of the shape, not a workflow bolted on. The fastest way to
populate this is to ask a language model, and a language model states a
plausible price with complete confidence. A price a buyer budgets against must
be read by someone before it is published.

Revision ID: 0023
Revises: 0022
"""
from alembic import op

revision = "0023"
down_revision = "0022"
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
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'variant_status') THEN
                CREATE TYPE variant_status AS ENUM ('draft', 'published');
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'variant_source') THEN
                CREATE TYPE variant_source AS ENUM ('manual', 'ai');
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS car_variants (
            id                UUID PRIMARY KEY,
            car_id            UUID NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
            name              VARCHAR(160) NOT NULL,
            ex_showroom_price NUMERIC(12, 2) NULL,
            fuel_type         VARCHAR(40) NULL,
            transmission      VARCHAR(40) NULL,
            engine_cc         SMALLINT NULL,
            seating_capacity  SMALLINT NULL,
            mileage           VARCHAR(40) NULL,
            features          JSONB NULL,
            status            variant_status NOT NULL DEFAULT 'draft',
            source            variant_source NOT NULL DEFAULT 'manual',
            sort_order        SMALLINT NOT NULL DEFAULT 0,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )

    op.execute("CREATE INDEX IF NOT EXISTS ix_car_variants_car_id ON car_variants (car_id);")
    op.execute("CREATE INDEX IF NOT EXISTS ix_car_variants_status ON car_variants (status);")

    # One trim per name per model. Case- and space-insensitive, because "VXi",
    # "vxi" and "VXi " are the same trim and three rows of it on a page is the
    # kind of thing nobody notices until a buyer does. Re-running research must
    # update rather than duplicate.
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ux_car_variants_car_name
        ON car_variants (car_id, lower(btrim(name)));
        """
    )


def downgrade() -> None:
    op.drop_table("car_variants")
    op.execute("DROP TYPE IF EXISTS variant_status;")
    op.execute("DROP TYPE IF EXISTS variant_source;")
