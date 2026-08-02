"""Add WAVE 3 ML fields to vehicle_media table.

Revision ID: 0011
Revises: 0010
Create Date: 2026-08-02 09:00:00.000000

"""
import sqlalchemy as sa

from alembic import op

revision = '0011'
down_revision = '0010'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add WAVE 3 ML fields to vehicle_media table
    op.add_column('vehicle_media', sa.Column('embedding_vector', sa.JSON, nullable=True))
    op.add_column('vehicle_media', sa.Column('ocr_text', sa.Text, nullable=True))
    op.add_column('vehicle_media', sa.Column('ocr_confidence', sa.Float, nullable=True))
    op.add_column('vehicle_media', sa.Column('ocr_entities', sa.JSON, nullable=True))
    op.add_column('vehicle_media', sa.Column('nsfw_score', sa.Float, nullable=True))
    op.add_column('vehicle_media', sa.Column('license_plate_detected', sa.Boolean, nullable=True))
    op.add_column('vehicle_media', sa.Column('license_plate_bbox', sa.JSON, nullable=True))
    op.add_column('vehicle_media', sa.Column('safety_metadata', sa.JSON, nullable=True))

    # Create indexes on ML fields for filtering and scoring
    op.create_index(op.f('ix_vehicle_media_ocr_confidence'), 'vehicle_media', ['ocr_confidence'], unique=False)
    op.create_index(op.f('ix_vehicle_media_nsfw_score'), 'vehicle_media', ['nsfw_score'], unique=False)
    op.create_index(op.f('ix_vehicle_media_license_plate_detected'), 'vehicle_media', ['license_plate_detected'], unique=False)


def downgrade() -> None:
    # Drop indexes
    op.drop_index(op.f('ix_vehicle_media_license_plate_detected'), table_name='vehicle_media')
    op.drop_index(op.f('ix_vehicle_media_nsfw_score'), table_name='vehicle_media')
    op.drop_index(op.f('ix_vehicle_media_ocr_confidence'), table_name='vehicle_media')

    # Drop columns
    op.drop_column('vehicle_media', 'safety_metadata')
    op.drop_column('vehicle_media', 'license_plate_bbox')
    op.drop_column('vehicle_media', 'license_plate_detected')
    op.drop_column('vehicle_media', 'nsfw_score')
    op.drop_column('vehicle_media', 'ocr_entities')
    op.drop_column('vehicle_media', 'ocr_confidence')
    op.drop_column('vehicle_media', 'ocr_text')
    op.drop_column('vehicle_media', 'embedding_vector')
