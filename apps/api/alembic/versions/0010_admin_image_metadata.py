"""Admin-supplied image metadata: category, rights, SEO, ordering.

Adds what an admin fills in when uploading a vehicle image directly, as opposed
to what a model inferred from a brochure: the catalogue's own image category,
fuel and transmission, hero/ordering flags, alt text and SEO fields, source and
licence, EXIF, and who uploaded it.

image_category is separate from kind/view on purpose. Those are a vision
model's guess and are useful for triaging brochure extracts; this is the
admin's choice and is what customer-facing pages filter on. Merging them would
let a misclassification change what a customer sees.

Revision ID: 0010
Revises: 0009
Create Date: 2026-07-30
"""
from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

_CATEGORIES = (
    "exterior_front", "exterior_rear", "exterior_left", "exterior_right",
    "front_quarter", "rear_quarter", "interior_dashboard", "steering",
    "infotainment", "seats", "boot_space", "engine_bay", "wheels", "sunroof",
    "safety", "accessories", "gallery", "three_sixty", "video",
)

# Idempotent throughout, matching 0009: startup runs `alembic upgrade head` but
# only LOGS a failure, so a half-applied migration otherwise leaves the API
# serving traffic against a schema it cannot use.
_COLUMNS = [
    ("fuel_type", "VARCHAR(40)", sa.Column("fuel_type", sa.String(40), nullable=True)),
    ("transmission", "VARCHAR(40)", sa.Column("transmission", sa.String(40), nullable=True)),
    ("is_primary", "BOOLEAN NOT NULL DEFAULT FALSE",
     sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false())),
    ("sort_order", "INTEGER NOT NULL DEFAULT 0",
     sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0")),
    ("alt_text", "VARCHAR(300)", sa.Column("alt_text", sa.String(300), nullable=True)),
    ("seo_keywords", "VARCHAR(500)", sa.Column("seo_keywords", sa.String(500), nullable=True)),
    ("ai_description", "TEXT", sa.Column("ai_description", sa.Text(), nullable=True)),
    ("source", "VARCHAR(200)", sa.Column("source", sa.String(200), nullable=True)),
    ("copyright", "VARCHAR(200)", sa.Column("copyright", sa.String(200), nullable=True)),
    ("license", "VARCHAR(100)", sa.Column("license", sa.String(100), nullable=True)),
    # See the model: "no perceptual hash" and "no make" are both legitimate
    # resting states, so the backfill needs a marker of its own rather than
    # inferring work from nulls it can never fill.
    ("enriched_at", "TIMESTAMPTZ",
     sa.Column("enriched_at", sa.DateTime(timezone=True), nullable=True)),
]


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        labels = ", ".join(f"'{c}'" for c in _CATEGORIES)
        op.execute(
            f"""
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'image_category') THEN
                    CREATE TYPE image_category AS ENUM ({labels});
                END IF;
            END $$;
            """
        )
        op.execute(
            "ALTER TABLE vehicle_media ADD COLUMN IF NOT EXISTS image_category image_category"
        )
        for name, ddl, _ in _COLUMNS:
            op.execute(f"ALTER TABLE vehicle_media ADD COLUMN IF NOT EXISTS {name} {ddl}")
        # JSON rather than JSONB: this is written once and read whole, never
        # queried by key, so the extra parse cost of JSONB buys nothing.
        op.execute("ALTER TABLE vehicle_media ADD COLUMN IF NOT EXISTS exif JSON")
        op.execute(
            "ALTER TABLE vehicle_media ADD COLUMN IF NOT EXISTS uploaded_by UUID "
            "REFERENCES users(id) ON DELETE SET NULL"
        )
    else:
        op.add_column("vehicle_media", sa.Column("image_category", sa.String(32), nullable=True))
        for _, _, column in _COLUMNS:
            op.add_column("vehicle_media", column)
        op.add_column("vehicle_media", sa.Column("exif", sa.JSON(), nullable=True))
        op.add_column(
            "vehicle_media",
            sa.Column("uploaded_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        )

    # Indexed on the fields a customer-facing gallery filters by. is_primary is
    # included because "the hero shot for this vehicle" is the single most
    # common media query in the product.
    for index_name, columns in [
        ("ix_vehicle_media_image_category", ["image_category"]),
        ("ix_vehicle_media_fuel_type", ["fuel_type"]),
        ("ix_vehicle_media_is_primary", ["is_primary"]),
        ("ix_vehicle_media_uploaded_by", ["uploaded_by"]),
        ("ix_vehicle_media_enriched_at", ["enriched_at"]),
    ]:
        if is_postgres:
            op.execute(
                f"CREATE INDEX IF NOT EXISTS {index_name} ON vehicle_media ({', '.join(columns)})"
            )
        else:
            op.create_index(index_name, "vehicle_media", columns)


def downgrade() -> None:
    for index_name in [
        "ix_vehicle_media_image_category",
        "ix_vehicle_media_fuel_type",
        "ix_vehicle_media_is_primary",
        "ix_vehicle_media_uploaded_by",
        "ix_vehicle_media_enriched_at",
    ]:
        op.execute(f"DROP INDEX IF EXISTS {index_name}")
    for column in [
        "image_category", "fuel_type", "transmission", "is_primary", "sort_order",
        "alt_text", "seo_keywords", "ai_description", "source", "copyright",
        "license", "exif", "uploaded_by", "enriched_at",
    ]:
        op.execute(f"ALTER TABLE vehicle_media DROP COLUMN IF EXISTS {column}")
    op.execute("DROP TYPE IF EXISTS image_category")
