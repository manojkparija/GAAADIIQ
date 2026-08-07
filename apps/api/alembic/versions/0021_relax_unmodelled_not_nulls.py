"""Stop columns the application has never heard of from blocking every insert.

    null value in column "fuel" of relation "cars" violates not-null constraint

cars carries columns from its Supabase past that no model declares — fuel
beside the fuel_type the application uses, and others visible in the failing
row. A column the ORM does not know about is a column it never supplies, so any
one of them that is NOT NULL and has no default makes every insert impossible,
whatever else is correct.

0018 dropped NOT NULL on the two such columns that were known by name, title
and price. Naming them one at a time is the same losing game the missing
columns were: an insert reports the first violation and stops, so each name
costs a deploy to discover.

The rule instead of the list: a column this application does not model, which
is mandatory and has no default, cannot be satisfied by this application. Every
such column is relaxed, and nothing else is touched — a column with a default
is already satisfiable, and a column the models do declare is the models'
business.

Nothing is dropped. The columns may hold data belonging to the Supabase-era
features that wrote them, and those features are not this migration's to
delete; making them optional is enough to unblock the application without
taking anything away.

The model columns are listed literally rather than imported from the models.
A migration describes one moment in the schema's history and must keep
describing it after the models move on; importing them would make this
migration mean something different next month.

Revision ID: 0021
Revises: 0020
Create Date: 2026-08-07 15:30:00.000000

"""
from __future__ import annotations

from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


# What each model declares, as of this migration. Anything outside these lists
# is a column the application cannot populate.
_MODELLED = {
    "cars": (
        "id", "make", "model", "variant", "year", "fuel_type", "transmission",
        "body_type", "seating_capacity", "engine_cc", "ex_showroom_price",
        "created_at", "updated_at",
        # Not a model column, but 0020 added it deliberately and it is nullable
        # anyway; listing it keeps the intent clear.
        "legacy_id",
    ),
    "listings": (
        "id", "car_id", "seller_id", "dealer_id", "listing_type", "price",
        "negotiable", "km_driven", "registration_year", "registration_state",
        "owners_count", "condition", "city", "description", "is_active",
        "is_featured", "views_count", "image_urls", "ai_valuation",
        "ai_valuation_at", "ai_method", "ai_confidence", "ai_reasoning",
        "created_at", "updated_at",
    ),
}


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for table, modelled in _MODELLED.items():
        columns = ", ".join(f"'{c}'" for c in modelled)
        op.execute(f"""
DO $$
DECLARE
    _column text;
BEGIN
    IF to_regclass('public.{table}') IS NULL THEN
        RETURN;
    END IF;

    FOR _column IN
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = '{table}'
          AND column_name NOT IN ({columns})
          AND is_nullable = 'NO'
          -- A column with a default is already satisfiable without the
          -- application naming it, so it is not in the way.
          AND column_default IS NULL
    LOOP
        EXECUTE format('ALTER TABLE {table} ALTER COLUMN %I DROP NOT NULL', _column);
        RAISE NOTICE
            '{table}.% is mandatory but not modelled, so no insert could '
            'satisfy it; made optional', _column;
    END LOOP;
END $$;
""")


def downgrade() -> None:
    # Restoring NOT NULL would restore the state in which the application
    # cannot insert a row at all.
    pass
