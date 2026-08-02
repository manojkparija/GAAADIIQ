"""Add vehicle_media_audit table for compliance logging.

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-02 08:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'vehicle_media_audit',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('media_id', sa.UUID(), nullable=False),
        sa.Column('action', postgresql.ENUM('upload', 'view', 'edit', 'delete', 'share', 'download', name='audit_action'), nullable=False),
        sa.Column('actor_id', sa.UUID(), nullable=True),
        sa.Column('ip_address', postgresql.INET(), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('audit_data', postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['media_id'], ['vehicle_media.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('idx_audit_media_id'), 'vehicle_media_audit', ['media_id'], unique=False)
    op.create_index(op.f('idx_audit_actor_id'), 'vehicle_media_audit', ['actor_id'], unique=False)
    op.create_index(op.f('idx_audit_created_at'), 'vehicle_media_audit', ['created_at'], unique=False)
    op.create_index(op.f('idx_audit_action'), 'vehicle_media_audit', ['action'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('idx_audit_action'), table_name='vehicle_media_audit')
    op.drop_index(op.f('idx_audit_created_at'), table_name='vehicle_media_audit')
    op.drop_index(op.f('idx_audit_actor_id'), table_name='vehicle_media_audit')
    op.drop_index(op.f('idx_audit_media_id'), table_name='vehicle_media_audit')
    op.drop_table('vehicle_media_audit')
    op.execute('DROP TYPE IF EXISTS audit_action')
