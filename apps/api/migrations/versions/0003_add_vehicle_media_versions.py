"""Add vehicle_media_versions table for version history.

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-02 07:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'vehicle_media_versions',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('media_id', sa.UUID(), nullable=False),
        sa.Column('event_type', postgresql.ENUM('created', 'metadata_updated', 'cropped', 'deleted', name='media_event_type'), nullable=False),
        sa.Column('actor_id', sa.UUID(), nullable=True),
        sa.Column('old_value', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('new_value', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['media_id'], ['vehicle_media.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('idx_media_versions_media_id'), 'vehicle_media_versions', ['media_id'], unique=False)
    op.create_index(op.f('idx_media_versions_actor_id'), 'vehicle_media_versions', ['actor_id'], unique=False)
    op.create_index(op.f('idx_media_versions_created_at'), 'vehicle_media_versions', ['created_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('idx_media_versions_created_at'), table_name='vehicle_media_versions')
    op.drop_index(op.f('idx_media_versions_actor_id'), table_name='vehicle_media_versions')
    op.drop_index(op.f('idx_media_versions_media_id'), table_name='vehicle_media_versions')
    op.drop_table('vehicle_media_versions')
    op.execute('DROP TYPE IF EXISTS media_event_type')
