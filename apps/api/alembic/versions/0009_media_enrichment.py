"""Richer image metadata, thumbnails, and a listing↔media link.

Brings vehicle_media up to the catalogue's needs: the year and category a
picture belongs to, the angle it was shot from, a thumbnail key, a perceptual
hash that survives re-encoding, and a link to the extracted vehicle it depicts.

Adds listing_media so a photograph is stored once and referenced by every
listing that shows it, rather than copied into each listing's image_urls array.

Revision ID: 0009
Revises: 0008
Create Date: 2026-07-30
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


# Written idempotently — IF NOT EXISTS on every add, DO block for the enum.
# Startup runs `alembic upgrade head` but only LOGS a failure, so a migration
# that half-applies leaves the API serving traffic against a schema it cannot
# use. Being re-runnable is what makes that recoverable.
def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        # CREATE TYPE has no IF NOT EXISTS before PG 9.6-era syntax rules make
        # it awkward inside a transaction, so guard on the catalogue instead.
        op.execute(
            """
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'media_view') THEN
                    CREATE TYPE media_view AS ENUM (
                        'unknown', 'front', 'front_three_quarter', 'side',
                        'rear_three_quarter', 'rear', 'top', 'detail'
                    );
                END IF;
            END $$;
            """
        )
        view_type = sa.dialects.postgresql.ENUM(name="media_view", create_type=False)
    else:
        # SQLite (tests) has no enum type; a VARCHAR with the same values is
        # what SQLAlchemy emits there anyway.
        view_type = sa.String(32)

    for name, column in [
        ("thumbnail_key", sa.Column("thumbnail_key", sa.String(512), nullable=True)),
        ("view", sa.Column("view", view_type, nullable=False, server_default="unknown")),
        ("model_year", sa.Column("model_year", sa.Integer(), nullable=True)),
        ("category", sa.Column("category", sa.String(40), nullable=True)),
        ("content_hash", sa.Column("content_hash", sa.String(64), nullable=True)),
        (
            "extracted_vehicle_id",
            sa.Column(
                "extracted_vehicle_id", sa.Uuid(),
                sa.ForeignKey("extracted_vehicles.id", ondelete="SET NULL"),
                nullable=True,
            ),
        ),
    ]:
        if is_postgres:
            # add_column has no IF NOT EXISTS in Alembic's API, so go to SQL for
            # the guard and let the ForeignKey be added separately below.
            if name == "extracted_vehicle_id":
                op.execute(
                    "ALTER TABLE vehicle_media ADD COLUMN IF NOT EXISTS "
                    "extracted_vehicle_id UUID REFERENCES extracted_vehicles(id) ON DELETE SET NULL"
                )
            elif name == "view":
                op.execute(
                    "ALTER TABLE vehicle_media ADD COLUMN IF NOT EXISTS "
                    "view media_view NOT NULL DEFAULT 'unknown'"
                )
            else:
                ddl = {
                    "thumbnail_key": "thumbnail_key VARCHAR(512)",
                    "model_year": "model_year INTEGER",
                    "category": "category VARCHAR(40)",
                    "content_hash": "content_hash VARCHAR(64)",
                }[name]
                op.execute(f"ALTER TABLE vehicle_media ADD COLUMN IF NOT EXISTS {ddl}")
        else:
            op.add_column("vehicle_media", column)

    # Indexed because the catalogue surfaces filter on these together, and
    # content_hash/phash are looked up per image during dedup.
    for index_name, columns in [
        ("ix_vehicle_media_model_year", ["model_year"]),
        ("ix_vehicle_media_category", ["category"]),
        ("ix_vehicle_media_content_hash", ["content_hash"]),
        ("ix_vehicle_media_extracted_vehicle_id", ["extracted_vehicle_id"]),
    ]:
        if is_postgres:
            op.execute(
                f"CREATE INDEX IF NOT EXISTS {index_name} "
                f"ON vehicle_media ({', '.join(columns)})"
            )
        else:
            op.create_index(index_name, "vehicle_media", columns)

    # A photograph shared by several listings is the reason this is a table and
    # not a column: two dealers listing the same variant in the same colour
    # reference one stored file instead of holding a copy each.
    if is_postgres:
        op.execute(
            """
            CREATE TABLE IF NOT EXISTS listing_media (
                listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
                media_id   UUID NOT NULL REFERENCES vehicle_media(id) ON DELETE CASCADE,
                position   INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (listing_id, media_id)
            )
            """
        )
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_listing_media_media_id ON listing_media (media_id)"
        )
    else:
        op.create_table(
            "listing_media",
            sa.Column("listing_id", sa.Uuid(), sa.ForeignKey("listings.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("media_id", sa.Uuid(), sa.ForeignKey("vehicle_media.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_listing_media_media_id", "listing_media", ["media_id"])

    # Existing rows carry an exact hash in phash from before the two were told
    # apart. Copy it to content_hash, which is what it actually was, and clear
    # phash so a real perceptual hash can be backfilled without a stale exact
    # digest masquerading as one.
    op.execute("UPDATE vehicle_media SET content_hash = phash WHERE content_hash IS NULL")
    op.execute("UPDATE vehicle_media SET phash = NULL")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS listing_media")
    for index_name in [
        "ix_vehicle_media_model_year",
        "ix_vehicle_media_category",
        "ix_vehicle_media_content_hash",
        "ix_vehicle_media_extracted_vehicle_id",
    ]:
        op.execute(f"DROP INDEX IF EXISTS {index_name}")
    for column in ["thumbnail_key", "view", "model_year", "category", "content_hash", "extracted_vehicle_id"]:
        op.execute(f"ALTER TABLE vehicle_media DROP COLUMN IF EXISTS {column}")
    op.execute("DROP TYPE IF EXISTS media_view")
