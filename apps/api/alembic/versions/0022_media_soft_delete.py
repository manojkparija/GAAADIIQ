"""Let an admin take a wrong photograph off the site without destroying it.

An image uploaded against the wrong car, or simply a bad shot, had no way out.
The upload screen could correct an image's metadata and re-point it at another
vehicle, but nothing could remove one from the site — a mistake stayed visible
to every buyer until someone opened the database.

Soft rather than hard: the audit log and version history reference these rows,
and destroying the row would destroy the record of what happened to it. A
removal is itself a thing that happened, by someone, at a time — and the most
likely correction to a hasty removal is putting the picture back.

The stored object is left in place for the same reason. It costs a few
kilobytes and it is what makes a restore instant and complete.

Revision ID: 0022
Revises: 0021
"""
from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Guarded: this database has been reconciled by hand more than once, and a
    # migration that assumes its own starting state is how a deploy stops.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'vehicle_media' AND column_name = 'deleted_at'
            ) THEN
                ALTER TABLE vehicle_media ADD COLUMN deleted_at TIMESTAMPTZ NULL;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'vehicle_media' AND column_name = 'deleted_by'
            ) THEN
                ALTER TABLE vehicle_media ADD COLUMN deleted_by UUID NULL;
            END IF;
        END $$;
        """
    )

    # Every read path filters on this, and they all filter for NULL — the
    # overwhelmingly common case. A partial index keeps the live set cheap to
    # scan without paying for the removed rows.
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_vehicle_media_live
        ON vehicle_media (make, model, model_year)
        WHERE deleted_at IS NULL;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_vehicle_media_live;")
    with op.batch_alter_table("vehicle_media") as batch:
        batch.drop_column("deleted_by")
        batch.drop_column("deleted_at")
