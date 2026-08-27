"""Add the seller_basic subscription tier.

WHY

The pricing page offers four plans — Free Buyer, Buyer Pro (₹299), Seller Basic
(₹499) and Dealer Pro (₹2,499). SubscriptionTier had three members, and none of
them was Seller Basic. The page's TIER_MAP had no entry for it either, so its
call to action fell through to a navigation instead of a checkout: a plan
displayed with a price that could not be bought.

TWO ENUMS, NOT ONE

routers/payments.py builds the payment purpose by string interpolation:

    PaymentPurpose(f"subscription_{payload.tier.value}")

so a tier with no matching purpose label raises ValueError inside the request
rather than at import. Adding subscription_tier.seller_basic without
payment_purpose.subscription_seller_basic would turn every Seller Basic
checkout into a 500. Both types are extended here, together.

ALTER TYPE ... ADD VALUE runs inside a transaction from PostgreSQL 12; the new
label may not be *used* in the same transaction, which this does not do.

Revision ID: 0045
Revises: 0044
"""
import sqlalchemy as sa

from alembic import op

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        # SQLite stores these columns as plain text and accepts any label, so
        # there is nothing to alter. This is also why the fault would not have
        # shown up on the SQLite job — see the note in ci-api.yml.
        return

    # Each type is checked for separately before it is altered.
    #
    # WHY, because the first version of this did not and took production down:
    # ALTER TYPE on a type that does not exist raises UndefinedObjectError, the
    # pre-deploy step exits 1, and no new version ships at all.
    #
    #   asyncpg.exceptions.UndefinedObjectError: type "subscription_tier" does
    #   not exist
    #   [SQL: ALTER TYPE subscription_tier ADD VALUE IF NOT EXISTS 'seller_basic']
    #   ==> Pre-deploy has failed
    #
    # "IF NOT EXISTS" guards the *value*, not the type — an easy thing to read
    # as covering both, and it does not.
    #
    # These types are created by migration 0001, so a database built by the
    # migration chain has them. Production was not: the marketplace tables were
    # applied from the hand-run schema_setup_batch*.sql files at the repo root,
    # which is the two-places schema problem CLAUDE.md opens with. Anything
    # touching an enum has to cope with either history.
    #
    # Skipping is the right answer rather than creating the type here. A
    # database with no subscription_tier has no subscriptions table using it,
    # so there is nothing for the new label to describe; inventing the type
    # would leave a type no column references and still no working feature.
    for type_name, label in (
        ("subscription_tier", "seller_basic"),
        ("payment_purpose", "subscription_seller_basic"),
    ):
        exists = bind.execute(
            sa.text("SELECT 1 FROM pg_type WHERE typname = :name"), {"name": type_name}
        ).scalar()
        if not exists:
            continue
        # Deliberately not wrapped in a DO block: ALTER TYPE ... ADD VALUE is
        # restricted inside one, and the check above already did the branching.
        op.execute(sa.text(f"ALTER TYPE {type_name} ADD VALUE IF NOT EXISTS '{label}'"))


def downgrade() -> None:
    """
    Not reversible, deliberately.

    PostgreSQL cannot drop a value from an enum. Doing it by hand means creating
    a replacement type, rewriting every column that uses it and dropping the
    old — and any row already holding 'seller_basic' has to be given some other
    tier first, which is a decision about a paying customer's subscription that
    a downgrade script must not make on its own.

    Leaving the label in place is harmless: nothing is required to use it.
    """
