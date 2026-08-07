"""Add vehicle_media_audit table for compliance logging (WAVE 2).

Revision ID: 0012
Revises: 0011
Create Date: 2026-08-02 08:00:00.000000

"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        # Create ENUM type if it doesn't exist
        op.execute("""
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_action') THEN
                    CREATE TYPE audit_action AS ENUM ('upload', 'view', 'edit', 'delete', 'share', 'download');
                END IF;
            END $$;
        """)

        # Create table if it doesn't exist
        op.execute("""
            CREATE TABLE IF NOT EXISTS vehicle_media_audit (
                id UUID NOT NULL PRIMARY KEY,
                media_id UUID NOT NULL,
                action audit_action NOT NULL,
                actor_id UUID,
                ip_address INET,
                user_agent TEXT,
                audit_data JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                FOREIGN KEY (media_id) REFERENCES vehicle_media(id) ON DELETE CASCADE
            )
        """)

        # Create indexes if they don't exist
        op.execute("""
            CREATE INDEX IF NOT EXISTS idx_audit_media_id ON vehicle_media_audit (media_id)
        """)
        op.execute("""
            CREATE INDEX IF NOT EXISTS idx_audit_actor_id ON vehicle_media_audit (actor_id)
        """)
        op.execute("""
            CREATE INDEX IF NOT EXISTS idx_audit_created_at ON vehicle_media_audit (created_at)
        """)
        op.execute("""
            CREATE INDEX IF NOT EXISTS idx_audit_action ON vehicle_media_audit (action)
        """)
    else:
        # SQLite
        op.create_table(
            "vehicle_media_audit",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("media_id", sa.UUID(), nullable=False),
            sa.Column("action", sa.String(32), nullable=False),
            sa.Column("actor_id", sa.UUID(), nullable=True),
            sa.Column("ip_address", sa.String(45), nullable=True),
            sa.Column("user_agent", sa.Text(), nullable=True),
            sa.Column("audit_data", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["media_id"], ["vehicle_media.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("idx_audit_media_id", "vehicle_media_audit", ["media_id"])
        op.create_index("idx_audit_actor_id", "vehicle_media_audit", ["actor_id"])
        op.create_index("idx_audit_created_at", "vehicle_media_audit", ["created_at"])
        op.create_index("idx_audit_action", "vehicle_media_audit", ["action"])


def downgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        op.execute("DROP INDEX IF EXISTS idx_audit_action")
        op.execute("DROP INDEX IF EXISTS idx_audit_created_at")
        op.execute("DROP INDEX IF EXISTS idx_audit_actor_id")
        op.execute("DROP INDEX IF EXISTS idx_audit_media_id")
        op.execute("DROP TABLE IF EXISTS vehicle_media_audit")
        op.execute("DROP TYPE IF EXISTS audit_action")
    else:
        op.drop_index("idx_audit_action", table_name="vehicle_media_audit")
        op.drop_index("idx_audit_created_at", table_name="vehicle_media_audit")
        op.drop_index("idx_audit_actor_id", table_name="vehicle_media_audit")
        op.drop_index("idx_audit_media_id", table_name="vehicle_media_audit")
        op.drop_table("vehicle_media_audit")
