"""Reconcile the deployed listings table with the listings model.

The listings table in the deployed database does not have the shape the
application expects. It was created from schema_setup_batch1_enums_and_core.sql
— a hand-written script that names the same concepts differently: price_inr for
price, mileage for km_driven, year for registration_year, location for city,
views for views_count — and omits negotiable, registration_state, owners_count,
is_active, image_urls and the ai_* valuation columns entirely. Because both that
script and alembic 0001 create the table only if it is absent, whichever ran
first won, and no later run of either corrected the other.

The consequence is not subtle: every read of a listing fails outright with
"column listings.price does not exist", so Used Cars is empty and the New Cars
page — which loads listings alongside the catalogue — goes down with it.

This migration makes the deployed table match the model rather than the
reverse. The model, its schemas, its indexes and every query in the API are
written against these names; the SQL script is not the definition of the schema.

Renaming rather than adding: price_inr holds real asking prices, and adding an
empty price column beside it would silently value every existing advert at
nothing. A rename carries the data across. Columns that never existed under
either name are added with the defaults the model declares.

Legacy-only columns (title) are kept but made nullable. Dropping them would
throw away data this migration has no mandate to delete, and leaving them NOT
NULL would make every ORM insert fail, since the model does not know to supply
them.

Every step is guarded, so this is a no-op on a database alembic 0001 built
correctly, and it can be re-run safely.

Revision ID: 0017
Revises: 0016
Create Date: 2026-08-07 09:30:00.000000

"""
from __future__ import annotations

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def _has(column: str) -> str:
    """SQL predicate: does listings currently carry this column?"""
    return (
        "EXISTS (SELECT 1 FROM information_schema.columns "
        f"WHERE table_name = 'listings' AND column_name = '{column}')"
    )


def _type_of(column: str) -> str:
    """SQL scalar: the column's data_type, or NULL when it is absent."""
    return (
        "(SELECT data_type FROM information_schema.columns "
        f"WHERE table_name = 'listings' AND column_name = '{column}')"
    )


# Legacy name -> model name. Applied only when the legacy column is present and
# the model's column is not, so a correct database is untouched.
_RENAMES = (
    ("price_inr", "price"),
    ("mileage", "km_driven"),
    ("year", "registration_year"),
    ("location", "city"),
    ("views", "views_count"),
)

# Columns the model declares, with the definition to use when one is missing.
_COLUMNS = (
    ("price", "NUMERIC(12, 2)"),
    ("negotiable", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("km_driven", "INTEGER"),
    ("registration_year", "SMALLINT"),
    ("registration_state", "VARCHAR(50)"),
    ("owners_count", "SMALLINT"),
    ("city", "VARCHAR(100)"),
    ("description", "TEXT"),
    ("is_active", "BOOLEAN NOT NULL DEFAULT TRUE"),
    ("is_featured", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("views_count", "INTEGER NOT NULL DEFAULT 0"),
    ("image_urls", "JSON NOT NULL DEFAULT '[]'::json"),
    ("ai_valuation", "NUMERIC(12, 2)"),
    ("ai_valuation_at", "TIMESTAMP WITH TIME ZONE"),
    ("ai_method", "VARCHAR(64)"),
    ("ai_confidence", "VARCHAR(16)"),
    ("ai_reasoning", "TEXT"),
)

_INDEXES = (
    ("ix_listings_city_type", "city, listing_type"),
    ("ix_listings_car_id", "car_id"),
    ("ix_listings_seller_id", "seller_id"),
    ("ix_listings_active_featured", "is_active, is_featured"),
    ("ix_listings_price", "price"),
    ("ix_listings_created_at", "created_at"),
)


def _reconcile_sql() -> str:
    renames = "\n".join(
        f"""
    IF {_has(old)} AND NOT {_has(new)} THEN
        ALTER TABLE listings RENAME COLUMN {old} TO {new};
    END IF;"""
        for old, new in _RENAMES
    )

    additions = "\n".join(
        f"    ALTER TABLE listings ADD COLUMN IF NOT EXISTS {name} {definition};"
        for name, definition in _COLUMNS
    )

    indexes = "\n".join(
        f"    CREATE INDEX IF NOT EXISTS {name} ON listings ({cols});"
        for name, cols in _INDEXES
    )

    return f"""
DO $$
DECLARE
    _row_count bigint;
    _car_id_type text;
    _cars_id_type text;
    _constraint text;
BEGIN
    IF to_regclass('public.listings') IS NULL THEN
        RETURN;  -- Nothing deployed yet; 0001 creates the table correctly.
    END IF;

    -- The enum types the model binds against. A varchar column would still
    -- read, but the API casts its parameters ($1::listing_type), so the type
    -- has to exist under that name.
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'listing_type') THEN
        CREATE TYPE listing_type AS ENUM ('new', 'used');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'listing_condition') THEN
        CREATE TYPE listing_condition AS ENUM ('excellent', 'good', 'fair', 'poor');
    END IF;

    -- Carry existing data across to the name the model uses.
{renames}

    -- Anything that never existed under either name.
{additions}

    -- price_inr was an integer count of rupees; price is money.
    IF {_type_of("price")} <> 'numeric' THEN
        ALTER TABLE listings ALTER COLUMN price TYPE NUMERIC(12, 2)
            USING price::numeric(12, 2);
    END IF;

    -- The model declares price NOT NULL, but only enforce that if the existing
    -- rows can satisfy it. Failing here would leave the table unreadable, which
    -- is the problem being fixed.
    IF NOT EXISTS (SELECT 1 FROM listings WHERE price IS NULL) THEN
        ALTER TABLE listings ALTER COLUMN price SET NOT NULL;
    END IF;

    -- Enum-typed columns that arrived as varchar from the legacy script.
    IF {_type_of("listing_type")} IN ('character varying', 'text') THEN
        ALTER TABLE listings ALTER COLUMN listing_type TYPE listing_type
            USING NULLIF(listing_type, '')::listing_type;
    END IF;
    IF {_type_of("condition")} IN ('character varying', 'text') THEN
        ALTER TABLE listings ALTER COLUMN condition TYPE listing_condition
            USING NULLIF(condition, '')::listing_condition;
    END IF;

    -- Legacy columns the model does not know about. Kept, because they may
    -- hold data, but they cannot stay mandatory or every insert fails.
    IF {_has("title")} THEN
        ALTER TABLE listings ALTER COLUMN title DROP NOT NULL;
    END IF;

    -- car_id: the legacy script typed it bigint against a bigserial cars.id,
    -- while cars is keyed by uuid. The two cannot be joined, and no cast
    -- recovers a uuid from a bigint, so this is only convertible while the
    -- table is empty.
    _car_id_type := {_type_of("car_id")};
    SELECT data_type INTO _cars_id_type FROM information_schema.columns
        WHERE table_name = 'cars' AND column_name = 'id';
    IF _car_id_type IS DISTINCT FROM 'uuid' AND _cars_id_type = 'uuid' THEN
        EXECUTE 'SELECT count(*) FROM listings' INTO _row_count;
        IF _row_count = 0 THEN
            FOR _constraint IN
                SELECT conname FROM pg_constraint
                WHERE conrelid = 'listings'::regclass AND contype = 'f'
                  AND conkey = ARRAY[(SELECT attnum FROM pg_attribute
                        WHERE attrelid = 'listings'::regclass AND attname = 'car_id')]
            LOOP
                EXECUTE format('ALTER TABLE listings DROP CONSTRAINT %I', _constraint);
            END LOOP;
            ALTER TABLE listings ALTER COLUMN car_id TYPE uuid USING NULL;
            ALTER TABLE listings ADD CONSTRAINT listings_car_id_fkey
                FOREIGN KEY (car_id) REFERENCES cars(id);
        ELSE
            RAISE WARNING
                'listings.car_id is % but cars.id is uuid, and listings holds % rows; '
                'the reference cannot be converted without deciding what those rows '
                'should point at.', _car_id_type, _row_count;
        END IF;
    END IF;

{indexes}
END $$;
"""


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        # SQLite development databases are built from the model itself, so they
        # already carry these columns and none of the legacy ones.
        return

    op.execute(_reconcile_sql())


def downgrade() -> None:
    # Deliberately not reversed. Going back means renaming price to price_inr
    # and dropping columns that by then hold data — negotiable, image_urls, the
    # ai_* valuations — to restore a shape no code in this repository can read.
    # There is nothing to return to.
    pass
