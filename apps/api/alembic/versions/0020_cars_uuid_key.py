"""Give the catalogue the uuid key the application requires, keeping its rows.

    column "id" is of type bigint but expression is of type uuid

The last of the shape mismatches, and the only one that could not be fixed by
adding a column. cars was keyed by bigserial while every model, schema and
foreign key in the application keys the catalogue by uuid, so reads worked once
the columns existed but no insert ever could.

0018 deliberately refused to convert this. It was right to: an integer key with
rows under it cannot be replaced by uuids without deciding what happens to
everything referencing those integers, and a migration should not decide that
alone. This one implements the decision that was made — convert, and carry the
references across.

What references a car by integer:

  - listings.car_id, where the ORM already expects uuid
  - test_drive_requests.car_id, seller_cars.car_id, car_enquiries.car_id —
    Supabase-era tables the application does not model, but which hold real
    test drive requests and enquiries

cars.legacy_id keeps the old integer permanently. It is what makes the remap
possible, and it stays afterwards because it is the only way to interpret an
integer car id found later — in a log, an old URL, a backup, or a table nobody
has remembered yet.

The unmodelled tables gain car_uuid beside their existing car_id rather than
having it replaced. The application does not read them, so rewriting their
schema would be a change to something outside its remit; adding a resolvable
column beside the unresolvable one loses nothing and presumes nothing.

Revision ID: 0020
Revises: 0019
Create Date: 2026-08-07 14:00:00.000000

"""
from __future__ import annotations

from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None

# Tables outside the application's models that reference a car by integer.
# Each gains a car_uuid resolving to the new key.
_LEGACY_REFERENCES = (
    ("test_drive_requests", "car_id"),
    ("seller_cars", "car_id"),
    ("car_enquiries", "car_id"),
)


def _remap_legacy(table: str, column: str) -> str:
    return f"""
    IF to_regclass('public.{table}') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = '{table}' AND column_name = '{column}') THEN
        ALTER TABLE {table} ADD COLUMN IF NOT EXISTS car_uuid uuid;
        EXECUTE 'UPDATE {table} d SET car_uuid = c.new_id
                 FROM cars c WHERE c.legacy_id = d.{column}::bigint';
        RAISE NOTICE 'Remapped {table}.{column} into {table}.car_uuid';
    END IF;"""


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    legacy = "\n".join(_remap_legacy(t, c) for t, c in _LEGACY_REFERENCES)

    op.execute(f"""
DO $$
DECLARE
    _constraint record;
BEGIN
    IF to_regclass('public.cars') IS NULL THEN
        RETURN;
    END IF;

    -- Already keyed correctly, by 0001 or by an earlier run of this migration.
    IF (SELECT data_type FROM information_schema.columns
        WHERE table_name = 'cars' AND column_name = 'id') = 'uuid' THEN
        RETURN;
    END IF;

    -- The old key, kept permanently: it is what makes the remap below
    -- possible, and afterwards the only way to interpret an integer car id
    -- found in a log, an old URL or a backup.
    ALTER TABLE cars ADD COLUMN IF NOT EXISTS legacy_id bigint;
    EXECUTE 'UPDATE cars SET legacy_id = id::bigint WHERE legacy_id IS NULL';

    -- The new key, assigned before anything is rewritten so that every
    -- reference can be pointed at a value that already exists.
    ALTER TABLE cars ADD COLUMN IF NOT EXISTS new_id uuid;
    EXECUTE 'UPDATE cars SET new_id = gen_random_uuid() WHERE new_id IS NULL';
    ALTER TABLE cars ALTER COLUMN new_id SET NOT NULL;

    -- Foreign keys pointing at the old column have to go before it can be
    -- dropped. listings' is re-added at the end against the new key; the rest
    -- belong to tables outside the models and are not restored, because a uuid
    -- constraint on an integer column is not a constraint anyone can satisfy.
    FOR _constraint IN
        SELECT conname, conrelid::regclass AS table_name
        FROM pg_constraint WHERE confrelid = 'cars'::regclass AND contype = 'f'
    LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',
                       _constraint.table_name, _constraint.conname);
    END LOOP;

    -- listings.car_id: the ORM already expects uuid here, so this is the
    -- reference that has to resolve rather than merely survive.
    IF to_regclass('public.listings') IS NOT NULL
       AND (SELECT data_type FROM information_schema.columns
            WHERE table_name = 'listings' AND column_name = 'car_id')
           IS DISTINCT FROM 'uuid' THEN
        ALTER TABLE listings ADD COLUMN IF NOT EXISTS car_uuid uuid;
        EXECUTE 'UPDATE listings l SET car_uuid = c.new_id
                 FROM cars c WHERE c.legacy_id = l.car_id::bigint';
        ALTER TABLE listings DROP COLUMN car_id;
        ALTER TABLE listings RENAME COLUMN car_uuid TO car_id;
    END IF;
{legacy}

    -- Swap the key itself. Dropping the column drops the primary key
    -- constraint with it, whatever that constraint happens to be named —
    -- assuming "cars_pkey" would fail on a table created by hand.
    ALTER TABLE cars DROP COLUMN id;
    ALTER TABLE cars RENAME COLUMN new_id TO id;
    ALTER TABLE cars ADD PRIMARY KEY (id);
    ALTER TABLE cars ALTER COLUMN id SET DEFAULT gen_random_uuid();

    -- Restore the reference the application actually uses.
    IF to_regclass('public.listings') IS NOT NULL THEN
        ALTER TABLE listings
            ADD CONSTRAINT listings_car_id_fkey
            FOREIGN KEY (car_id) REFERENCES cars(id);
    END IF;

    RAISE NOTICE 'cars is now keyed by uuid; the previous integer key is in cars.legacy_id';
END $$;
""")


def downgrade() -> None:
    # Not reversed. legacy_id makes the old integers recoverable, but the rows
    # inserted after this point never had one, and inventing integers for them
    # would produce a key that means nothing.
    pass
