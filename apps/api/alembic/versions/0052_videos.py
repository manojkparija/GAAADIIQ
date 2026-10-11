"""GAADIIQ's own videos for the Reviews & News hub.

A new table rather than a column on anything existing. The news surface looked
like the natural home and is not one: GET /news is a live third-party feed, and
the `news` table in supabase/migrations/001 is read by nothing in the frontend
or this API. Hanging a column off an unread table would have shipped nothing.

THE CHECK CONSTRAINT IS THE POINT

`youtube_id` holds the eleven-character video id and the column refuses
anything else. That id is interpolated into an iframe `src`, so a column that
cannot express a javascript: URL or a foreign origin makes the embed safe by
construction. The API validates too, but validation in a request handler only
covers the path somebody routed through it; the constraint covers every path,
including a hand-run UPDATE.

Postgres-only syntax (`~`). The model declares the same constraint under
`.ddl_if(dialect="postgresql")`, because SQLite -- which part of the test
suite runs on -- treats `~` as a syntax error and fails CREATE TABLE outright.
This migration only ever runs against Postgres, so it carries the constraint
plainly.
"""
import sqlalchemy as sa

from alembic import op

revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "videos",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("youtube_id", sa.String(length=11), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("car_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("car_label", sa.String(length=200), nullable=True),
        sa.Column(
            "is_published", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("youtube_id", name="uq_videos_youtube_id"),
        sa.CheckConstraint(
            "youtube_id ~ '^[A-Za-z0-9_-]{11}$'",
            name="ck_video_youtube_id_shape",
        ),
    )
    op.create_index(
        "ix_videos_published", "videos", ["is_published", "published_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_videos_published", table_name="videos")
    op.drop_table("videos")
