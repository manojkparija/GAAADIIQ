"""Add vehicle_media_versions table for version history (WAVE 2).

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-02 07:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        # Create ENUM type if it doesn't exist
        op.execute("""
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'media_event_type') THEN
                    CREATE TYPE media_event_type AS ENUM ('created', 'metadata_updated', 'cropped', 'deleted');
                END IF;
            END $$;
        """)

        # Create table if it doesn't exist
        op.execute("""
            CREATE TABLE IF NOT EXISTS vehicle_media_versions (
                id UUID NOT NULL PRIMARY KEY,
                media_id UUID NOT NULL,
                event_type media_event_type NOT NULL,
                actor_id UUID,
                old_value JSONB,
                new_value JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                FOREIGN KEY (media_id) REFERENCES vehicle_media(id)
            )
        """)

        # Create indexes if they don't exist
        op.execute("""
            CREATE INDEX IF NOT EXISTS idx_media_versions_media_id ON vehicle_media_versions (media_id)
        """)
        op.execute("""
            CREATE INDEX IF NOT EXISTS idx_media_versions_actor_id ON vehicle_media_versions (actor_id)
        """)
        op.execute("""
            CREATE INDEX IF NOT EXISTS idx_media_versions_created_at ON vehicle_media_versions (created_at)
        """)
    else:
        # SQLite
        op.create_table(
            "vehicle_media_versions",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("media_id", sa.UUID(), nullable=False),
            sa.Column("event_type", sa.String(32), nullable=False),
            sa.Column("actor_id", sa.UUID(), nullable=True),
            sa.Column("old_value", sa.JSON(), nullable=True),
            sa.Column("new_value", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["media_id"], ["vehicle_media.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("idx_media_versions_media_id", "vehicle_media_versions", ["media_id"])
        op.create_index("idx_media_versions_actor_id", "vehicle_media_versions", ["actor_id"])
        op.create_index("idx_media_versions_created_at", "vehicle_media_versions", ["created_at"])


def downgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        op.execute("DROP INDEX IF EXISTS idx_media_versions_created_at")
        op.execute("DROP INDEX IF EXISTS idx_media_versions_actor_id")
        op.execute("DROP INDEX IF EXISTS idx_media_versions_media_id")
        op.execute("DROP TABLE IF EXISTS vehicle_media_versions")
        op.execute("DROP TYPE IF EXISTS media_event_type")
    else:
        op.drop_index("idx_media_versions_created_at", table_name="vehicle_media_versions")
        op.drop_index("idx_media_versions_actor_id", table_name="vehicle_media_versions")
        op.drop_index("idx_media_versions_media_id", table_name="vehicle_media_versions")
        op.drop_table("vehicle_media_versions")
