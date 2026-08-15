"""Let a diagnosis exist without a listing.

Production's `vehicle_diagnoses` has a `listing_id` column that is NOT NULL.
It appears in no model and no migration — it predates both, like the columns
0017-0030 were written to reconcile. Nothing in the application has ever set
it, so every INSERT failed:

    NotNullViolationError: null value in column "listing_id" of relation
    "vehicle_diagnoses" violates not-null constraint

which surfaced as a 500 on every POST /diagnosis/analyse.

The constraint is wrong on its own terms, not merely inconvenient. A diagnosis
is about a *vehicle a driver owns*; the marketplace listing is a different
thing entirely, and most diagnoses have no listing at all. Requiring one asks
for a value that does not exist.

Dropping NOT NULL rather than the column: it is not ours to delete. Something
outside this application may have written it, and an unused nullable column
costs nothing while a wrong DROP is unrecoverable.

Guarded by an existence check, because a database built from this migration
chain has no such column and `ALTER COLUMN` on a missing column errors.

Revision ID: 0035
Revises: 0034
"""

from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'vehicle_diagnoses'
                  AND column_name = 'listing_id'
                  AND is_nullable = 'NO'
            ) THEN
                ALTER TABLE vehicle_diagnoses ALTER COLUMN listing_id DROP NOT NULL;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # Deliberately not restored. Re-imposing NOT NULL would fail against the
    # rows this migration makes possible, and would restore a constraint that
    # broke the endpoint.
    pass
