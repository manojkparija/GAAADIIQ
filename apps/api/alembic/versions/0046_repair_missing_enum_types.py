"""Create the enum types production never had, and convert the columns.

WHAT IS WRONG IN PRODUCTION

Eight enum types the ORM declares do not exist there, and every one of them
backs a column on a table that does:

    activitytype        customer_activities.activity_type
    booking_status      test_drive_bookings.status
    employment_type     loan_inquiries.employment_type
    leadgrade           customer_intent_scores.lead_grade
    loan_status         loan_inquiries.status
    payment_purpose     payments.purpose
    payment_status      payments.status
    subscription_tier   subscriptions.tier

The columns are varchar. SQLAlchemy's asyncpg dialect renders a bind cast for
a native enum column, so every INSERT emits `$n::payment_status` against a type
that is not there. Measured against a database rebuilt in that exact shape:

    INSERT: FAILED -> UndefinedObjectError: type "payment_status" does not exist

So payments, subscriptions, test-drive bookings, loan enquiries, the
behavioural instrumentation and lead scoring cannot write a row. Each of those
features shipped green: CI builds its database from this migration chain, which
creates all 61 types, while production's tables came from the hand-run
schema_setup_batch*.sql files at the repo root. That is the two-places schema
problem CLAUDE.md opens with, and no test could have seen it.

WHY CONVERT RATHER THAN CHANGE THE MODELS

The ORM is the source of truth in this repo — the same call CLAUDE.md records
for cars.id being a UUID while Batch 1 SQL says bigint. Relaxing eight columns
to plain strings would also drop the constraint that makes a bad label
impossible, on the columns that decide what a customer was charged for.

SAFE HERE, SPECIFICALLY

All eight tables are empty in production (measured, 0 rows each), so no stored
value can fail the cast. The USING clause is still written explicitly rather
than relying on an implicit conversion, because this migration will also run on
databases that are not production and may not be empty — and a cast that cannot
be made should stop the migration, not silently drop rows.

Each type is handled independently and skipped when it already exists, so this
is a no-op on any database built from the chain: CI, every dev machine, and
production once it has run. That is the same guard shape as 0045, which was
added after an unguarded ALTER TYPE took production's deploys down.

Revision ID: 0046
Revises: 0045
"""
import sqlalchemy as sa

from alembic import op

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


#: (type name, table, column, labels) — labels as the ORM declares them today.
#: Written out rather than imported from the models: a migration describes the
#: schema at a point in time, and one that follows the models forward stops
#: being a record of what it did.
_TYPES: list[tuple[str, str, str, list[str]]] = [
    ("activitytype", "customer_activities", "activity_type", [
        "listing_view", "search", "enquiry", "test_drive_request", "loan_inquiry",
        "price_alert", "whatsapp_click", "photo_view", "compare", "revisit",
        "brochure_download",
    ]),
    ("booking_status", "test_drive_bookings", "status", [
        "pending", "confirmed", "cancelled", "completed",
    ]),
    ("employment_type", "loan_inquiries", "employment_type", [
        "salaried", "self_employed", "business",
    ]),
    ("leadgrade", "customer_intent_scores", "lead_grade", ["A", "B", "C", "D"]),
    ("loan_status", "loan_inquiries", "status", [
        "submitted", "processing", "approved", "rejected",
    ]),
    ("payment_purpose", "payments", "purpose", [
        "featured_listing", "subscription_pro", "subscription_seller_basic",
        "subscription_dealer", "service_request",
    ]),
    ("payment_status", "payments", "status", [
        "pending", "paid", "failed", "refunded",
    ]),
    ("subscription_tier", "subscriptions", "tier", [
        "free", "pro", "seller_basic", "dealer",
    ]),
]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        # SQLite stores these columns as text and accepts any label, so there
        # is nothing to create and nothing to convert — and it is why the
        # SQLite job could never have caught the fault this repairs.
        return

    for type_name, table, column, labels in _TYPES:
        type_exists = bind.execute(
            sa.text("SELECT 1 FROM pg_type WHERE typname = :n"), {"n": type_name}
        ).scalar()
        if type_exists:
            # A database built from the chain already has it, correctly applied
            # to the column. Nothing to do, and nothing to risk.
            continue

        table_exists = bind.execute(
            sa.text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = :t"
            ), {"t": table}
        ).scalar()

        labels_sql = ", ".join(f"'{label}'" for label in labels)
        op.execute(sa.text(f"CREATE TYPE {type_name} AS ENUM ({labels_sql})"))

        if not table_exists:
            # The type is created regardless: a later migration or a model may
            # reference it, and a missing type is what caused the original
            # failure. But there is no column to convert yet.
            continue

        # Explicit USING, and explicit about the current type, so a value that
        # is not a valid label raises here rather than being coerced.
        op.execute(sa.text(
            f"ALTER TABLE {table} "
            f"ALTER COLUMN {column} TYPE {type_name} "
            f"USING {column}::text::{type_name}"
        ))


def downgrade() -> None:
    """
    Convert the columns back to varchar and drop the types.

    Reversible, unlike 0045, because this creates whole types rather than
    adding a label to one that other rows may already be using. Dropping a type
    this migration created returns the database to the shape it was in.

    The columns are widened back to text rather than to their original
    varchar(n): the lengths in the hand-run SQL varied by column and are not
    recorded anywhere this migration can read, and guessing one too short would
    truncate data on the way down.
    """
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for type_name, table, column, _labels in reversed(_TYPES):
        table_exists = bind.execute(
            sa.text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = :t"
            ), {"t": table}
        ).scalar()
        if table_exists:
            op.execute(sa.text(
                f"ALTER TABLE {table} ALTER COLUMN {column} TYPE text "
                f"USING {column}::text"
            ))
        op.execute(sa.text(f"DROP TYPE IF EXISTS {type_name}"))
