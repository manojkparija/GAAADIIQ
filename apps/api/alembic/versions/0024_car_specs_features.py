"""A model's specification and feature list, as data.

The Specs and Features tabs read car.specs and car.features, which were filled
from MODEL_SPECS — a literal in the Angular service covering one model, the
Dzire. Every other car showed "Specifications for this car haven't been added
yet", and nothing an admin could do changed that.

JSON rather than tables: a specification is a list of label/value pairs read
top to bottom, and a feature is a string in a bullet list. Nothing queries
across them, and normalising would cost a migration every time a manufacturer
invents a name for a cupholder.

Revision ID: 0024
Revises: 0023
"""
from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'cars' AND column_name = 'specs'
            ) THEN
                ALTER TABLE cars ADD COLUMN specs JSONB NULL;
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'cars' AND column_name = 'features'
            ) THEN
                ALTER TABLE cars ADD COLUMN features JSONB NULL;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("cars") as batch:
        batch.drop_column("features")
        batch.drop_column("specs")
