"""Let a guest run a diagnosis.

Production's `vehicle_diagnoses.user_id` is NOT NULL. Migration 0006 created
that column `nullable=True` and the model has always declared it optional
("Who submitted (optional — guests can use too)"), so the constraint came from
outside this chain — the same class of drift 0035 fixed for `listing_id`, and
the same shape: the hand-run schema_setup_batch SQL and the migrations do not
agree, and the database wins.

Measured on Render, on every anonymous diagnosis:

    ERROR [gaadiiq.diagnosis] Diagnosis computed but not stored (IntegrityError):
    asyncpg.exceptions.NotNullViolationError: null value in column "user_id" of
    relation "vehicle_diagnoses" violates not-null constraint

WHY NOBODY SAW IT

The router catches the IntegrityError, logs it, and returns the diagnosis
anyway — so the caller got 201 Created with a complete report while nothing was
persisted. From the app it looked like it worked. Every guest diagnosis since
the constraint appeared has been lost; only the log knew.

CI could not catch it either. The suite builds its schema from these
migrations, where the column is already nullable, and
test_migrations_match_models.py compares table and column NAMES, not
nullability — so a green run says nothing about this.

The constraint is wrong on its own terms. The endpoint takes no authentication
(`OptionalUser`), the feature is offered to signed-out visitors, and requiring
a user id asks for a value that does not exist at that point.

Guarded by an existence check: a database built from this chain already has the
column nullable, and this must be a no-op there rather than an error.

Revision ID: 0048
Revises: 0047
"""

from alembic import op

revision = "0048"
down_revision = "0047"
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
                  AND column_name = 'user_id'
                  AND is_nullable = 'NO'
            ) THEN
                ALTER TABLE vehicle_diagnoses ALTER COLUMN user_id DROP NOT NULL;
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # Deliberately not restored, as in 0035. Re-imposing NOT NULL would fail
    # against the guest rows this makes possible, and would restore the
    # constraint that silently discarded them.
    pass
