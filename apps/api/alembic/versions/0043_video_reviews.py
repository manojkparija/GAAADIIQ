"""video_reviews: owner-submitted video reviews, held for moderation

Revision ID: 0043
Revises: 0042
Create Date: 2026-08-23

THE ENUM TRAP

`op.create_table` emits CREATE TYPE for every Enum column it sees, so a type
named twice in one migration fails the second time and a type created here and
again by a later migration fails then. The type is created once, explicitly,
and every column reference passes create_type=False — the same shape as 0041
and 0042. Only CI's Postgres job catches a mistake here; SQLite has no native
enums and will happily accept the wrong thing.
"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None

STATUS_VALUES = ("pending", "approved", "rejected", "withdrawn")
STATUS_NAME = "video_review_status"


def _status(create_type: bool):
    return postgresql.ENUM(*STATUS_VALUES, name=STATUS_NAME, create_type=create_type)


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    if is_pg:
        _status(create_type=True).create(bind, checkfirst=True)

    status_col = _status(create_type=False) if is_pg else sa.String(20)

    op.create_table(
        "video_reviews",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True),
            primary_key=True, server_default=sa.text("gen_random_uuid()") if is_pg else None,
        ),
        # NOT NULL: an anonymous video upload is exactly what this table exists
        # to prevent, and a nullable author would let it back in the first time
        # somebody writes an endpoint that forgets the check.
        sa.Column(
            "author_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False,
        ),
        # No FK to cars: the catalogue is rebuilt by ingestion, and a cascade
        # from it would silently delete people's reviews.
        sa.Column("car_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("car_label", sa.String(200), nullable=True),
        sa.Column("rating", sa.SmallInteger(), nullable=False),
        sa.Column("title", sa.String(200), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        # A storage key, not a URL: URLs expire and move between buckets, the
        # key is what identifies the object.
        sa.Column("video_key", sa.String(500), nullable=False),
        sa.Column("video_content_type", sa.String(100), nullable=True),
        sa.Column("video_bytes", sa.Integer(), nullable=True),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column("status", status_col, nullable=False, server_default="pending"),
        sa.Column(
            "reviewed_by", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("rating >= 1 AND rating <= 5", name="ck_video_review_rating_range"),
        # A rejection with no reason is unanswerable when the author asks why.
        sa.CheckConstraint(
            "status <> 'rejected' OR review_note IS NOT NULL",
            name="ck_video_review_rejection_has_reason",
        ),
    )

    op.create_index("ix_video_reviews_author_id", "video_reviews", ["author_id"])
    # The public read: approved reviews for one car.
    op.create_index("ix_video_reviews_car_status", "video_reviews", ["car_id", "status"])
    # The moderation queue.
    op.create_index("ix_video_reviews_status_created", "video_reviews", ["status", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_video_reviews_status_created", table_name="video_reviews")
    op.drop_index("ix_video_reviews_car_status", table_name="video_reviews")
    op.drop_index("ix_video_reviews_author_id", table_name="video_reviews")
    op.drop_table("video_reviews")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        _status(create_type=False).drop(bind, checkfirst=True)
