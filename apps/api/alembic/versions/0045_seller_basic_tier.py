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

    op.execute(sa.text("ALTER TYPE subscription_tier ADD VALUE IF NOT EXISTS 'seller_basic'"))
    op.execute(
        sa.text("ALTER TYPE payment_purpose ADD VALUE IF NOT EXISTS 'subscription_seller_basic'")
    )


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
