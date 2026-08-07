"""Reconcile the deployed cars table with the cars model.

The same fault as migration 0017, in the other core table. The deployed cars
table does not have the shape the application describes:

    column cars.fuel_type does not exist

so every catalogue read — /cars, the New Cars pages, and the catalogue lookup
the admin image upload now performs — fails outright. This is why New Cars was
empty even for models that had been photographed: the emptiness was never about
missing prices.

Where listings was created by schema_setup_batch1_enums_and_core.sql, cars
appears to have been created directly in Supabase and then extended by
supabase/migrations/008_cars_seller_columns.sql, which adds seller_email,
seller_id, owners and is_seller_listing — columns the application has never
heard of — while never adding fuel_type, transmission, seating_capacity or
engine_cc, which it requires.

The approach is the one 0017 took, for the same reasons: make the table match
the model, since the model is what every query is written against; rename where
a legacy column holds the same fact under another name, so data survives; add
what never existed; and guard every step so this is a no-op on a database
alembic 0001 built correctly.

Enum columns get one extra care. body_type already exists as free text holding
whatever was typed into it ("SUV", "Hatchback"). Converting it with a plain
cast would fail the whole migration on the first value outside the enum, so
unrecognised values become NULL instead: the application could never have
interpreted them anyway, and a failed migration leaves the table unreadable —
which is the problem being fixed.

cars.id is not forced. If it is an integer key, every uuid foreign key pointing
at it is already meaningless, and no cast invents the right uuid. It is
converted only while the table is empty and otherwise reported, because
choosing what the existing rows should become is not a migration's decision.

Revision ID: 0018
Revises: 0017
Create Date: 2026-08-07 12:50:00.000000

"""
from __future__ import annotations

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def _has(column: str) -> str:
    """SQL predicate: does cars currently carry this column?"""
    return (
        "EXISTS (SELECT 1 FROM information_schema.columns "
        f"WHERE table_name = 'cars' AND column_name = '{column}')"
    )


def _type_of(column: str) -> str:
    """SQL scalar: the column's data_type, or NULL when it is absent."""
    return (
        "(SELECT data_type FROM information_schema.columns "
        f"WHERE table_name = 'cars' AND column_name = '{column}')"
    )


# Legacy name -> model name, applied only when the legacy column is present and
# the model's is not. year_from is the model year a variant was introduced,
# which is what the catalogue's single year means.
_RENAMES = (
    ("year_from", "year"),
    ("seats", "seating_capacity"),
    ("cc", "engine_cc"),
)

_COLUMNS = (
    ("make", "VARCHAR(100)"),
    ("model", "VARCHAR(100)"),
    ("variant", "VARCHAR(100)"),
    ("year", "SMALLINT"),
    ("seating_capacity", "SMALLINT"),
    ("engine_cc", "SMALLINT"),
    ("ex_showroom_price", "NUMERIC(12, 2)"),
)

# Enum-typed columns: the type, its members, and the column that carries it.
_ENUMS = (
    ("fuel_type", ("petrol", "diesel", "electric", "cng", "hybrid")),
    ("transmission", ("manual", "automatic", "amt", "cvt", "dct")),
    (
        "body_type",
        ("hatchback", "sedan", "suv", "muv", "coupe", "convertible"),
    ),
)

_INDEXES = (
    ("ix_cars_make_model_year", "make, model, year"),
    ("ix_cars_fuel_type", "fuel_type"),
    ("ix_cars_body_type", "body_type"),
)


def _reconcile_sql() -> str:
    renames = "\n".join(
        f"""
    IF {_has(old)} AND NOT {_has(new)} THEN
        ALTER TABLE cars RENAME COLUMN {old} TO {new};
    END IF;"""
        for old, new in _RENAMES
    )

    additions = "\n".join(
        f"    ALTER TABLE cars ADD COLUMN IF NOT EXISTS {name} {definition};"
        for name, definition in _COLUMNS
    )

    enum_types = "\n".join(
        f"""
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '{name}') THEN
        CREATE TYPE {name} AS ENUM ({", ".join(f"'{m}'" for m in members)});
    END IF;"""
        for name, members in _ENUMS
    )

    # Add the column as the enum type when absent; convert it when it exists as
    # text. The CASE keeps a value the enum does not contain from failing the
    # whole migration.
    enum_columns = "\n".join(
        f"""
    IF NOT {_has(name)} THEN
        ALTER TABLE cars ADD COLUMN {name} {name};
    ELSIF {_type_of(name)} IN ('character varying', 'text') THEN
        ALTER TABLE cars ALTER COLUMN {name} TYPE {name} USING (
            CASE WHEN lower(trim({name})) IN ({", ".join(f"'{m}'" for m in members)})
                 THEN lower(trim({name}))::{name}
                 ELSE NULL
            END
        );
    END IF;"""
        for name, members in _ENUMS
    )

    indexes = "\n".join(
        f"    CREATE INDEX IF NOT EXISTS {name} ON cars ({cols});"
        for name, cols in _INDEXES
    )

    return f"""
DO $$
DECLARE
    _row_count bigint;
    _id_type text;
    _constraint text;
BEGIN
    IF to_regclass('public.cars') IS NULL THEN
        RETURN;  -- Nothing deployed yet; 0001 creates the table correctly.
    END IF;
{enum_types}

    -- Carry existing data across to the name the model uses.
{renames}

    -- Anything that never existed under either name.
{additions}
{enum_columns}

    -- make and model are the catalogue's identity and the model declares them
    -- NOT NULL, but only enforce that if the existing rows can satisfy it.
    IF NOT EXISTS (SELECT 1 FROM cars WHERE make IS NULL OR model IS NULL) THEN
        ALTER TABLE cars ALTER COLUMN make SET NOT NULL;
        ALTER TABLE cars ALTER COLUMN model SET NOT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cars WHERE year IS NULL) THEN
        ALTER TABLE cars ALTER COLUMN year SET NOT NULL;
    END IF;

    -- Columns from the Supabase-era table that the model does not know about.
    -- Kept, because they may hold data, but they cannot stay mandatory or
    -- every insert the application makes fails.
    IF {_has("title")} THEN
        ALTER TABLE cars ALTER COLUMN title DROP NOT NULL;
    END IF;
    IF {_has("price")} THEN
        ALTER TABLE cars ALTER COLUMN price DROP NOT NULL;
    END IF;

    -- An integer key cannot become the uuid the application expects: nothing
    -- recovers which uuid an existing row should have had, and every uuid
    -- foreign key already pointing here is meaningless either way. Convert
    -- only an empty table; otherwise say so and leave it alone.
    _id_type := {_type_of("id")};
    IF _id_type IS DISTINCT FROM 'uuid' THEN
        EXECUTE 'SELECT count(*) FROM cars' INTO _row_count;
        IF _row_count = 0 THEN
            ALTER TABLE cars ALTER COLUMN id DROP DEFAULT;
            ALTER TABLE cars ALTER COLUMN id TYPE uuid USING gen_random_uuid();
            ALTER TABLE cars ALTER COLUMN id SET DEFAULT gen_random_uuid();
        ELSE
            RAISE WARNING
                'cars.id is % but the application keys the catalogue by uuid, '
                'and cars holds % rows. Every uuid reference to a car is '
                'already unresolvable; converting needs a decision about what '
                'those rows should become.', _id_type, _row_count;
        END IF;
    END IF;

{indexes}

    -- 0017 decided whether listings.car_id could become a uuid by looking at
    -- cars.id, which may only have become one a few statements ago. That
    -- migration will not run again, so the same conversion is repeated here
    -- rather than left permanently undone. It is guarded identically and does
    -- nothing when 0017 already succeeded.
    IF to_regclass('public.listings') IS NOT NULL
       AND (SELECT data_type FROM information_schema.columns
            WHERE table_name = 'cars' AND column_name = 'id') = 'uuid'
       AND (SELECT data_type FROM information_schema.columns
            WHERE table_name = 'listings' AND column_name = 'car_id')
           IS DISTINCT FROM 'uuid' THEN
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
        END IF;
    END IF;
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
    # Deliberately not reversed, for the reason 0017 gives: the previous shape
    # is one no code in this repository can read, and going back means dropping
    # columns that by then hold data.
    pass
