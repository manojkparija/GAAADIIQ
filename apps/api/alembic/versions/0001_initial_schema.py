"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-07-15
"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


_ENUM_NAMES = [
    "fuel_type", "transmission", "body_type", "user_role",
    "listing_type", "listing_condition", "booking_status",
    "loan_status", "employment_type", "notification_type",
    "payment_status", "payment_purpose", "subscription_tier",
]


def upgrade() -> None:
    # ── Enums ──────────────────────────────────────────────────────────────────
    # Drop any pre-existing enums from partial migrations (safe: tables not yet created).
    for name in _ENUM_NAMES:
        op.execute(sa.text(f"DROP TYPE IF EXISTS {name} CASCADE"))

    op.execute(sa.text("CREATE TYPE fuel_type AS ENUM ('petrol','diesel','electric','cng','hybrid')"))
    op.execute(sa.text("CREATE TYPE transmission AS ENUM ('manual','automatic','amt','cvt','dct')"))
    op.execute(sa.text("CREATE TYPE body_type AS ENUM ('hatchback','sedan','suv','muv','coupe','convertible')"))
    op.execute(sa.text("CREATE TYPE user_role AS ENUM ('buyer','seller','dealer','admin')"))
    op.execute(sa.text("CREATE TYPE listing_type AS ENUM ('new','used')"))
    op.execute(sa.text("CREATE TYPE listing_condition AS ENUM ('excellent','good','fair','poor')"))
    op.execute(sa.text("CREATE TYPE booking_status AS ENUM ('pending','confirmed','cancelled','completed')"))
    op.execute(sa.text("CREATE TYPE loan_status AS ENUM ('submitted','processing','approved','rejected')"))
    op.execute(sa.text("CREATE TYPE employment_type AS ENUM ('salaried','self_employed','business')"))
    op.execute(sa.text(
        "CREATE TYPE notification_type AS ENUM ("
        "'booking_received','booking_confirmed','booking_cancelled',"
        "'loan_inquiry_received','price_drop','listing_viewed','system')"
    ))
    op.execute(sa.text("CREATE TYPE payment_status AS ENUM ('pending','paid','failed','refunded')"))
    op.execute(sa.text(
        "CREATE TYPE payment_purpose AS ENUM ('featured_listing','subscription_pro','subscription_dealer')"
    ))
    op.execute(sa.text("CREATE TYPE subscription_tier AS ENUM ('free','pro','dealer')"))

    # ── Tables ─────────────────────────────────────────────────────────────────
    op.create_table(
        "cars",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("make", sa.String(100), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("variant", sa.String(100)),
        sa.Column("year", sa.SmallInteger, nullable=False),
        sa.Column("fuel_type", sa.Enum("petrol", "diesel", "electric", "cng", "hybrid", name="fuel_type")),
        sa.Column("transmission", sa.Enum("manual", "automatic", "amt", "cvt", "dct", name="transmission")),
        sa.Column("body_type", sa.Enum("hatchback", "sedan", "suv", "muv", "coupe", "convertible", name="body_type")),
        sa.Column("seating_capacity", sa.SmallInteger),
        sa.Column("engine_cc", sa.SmallInteger),
    )
    op.create_index("ix_cars_make_model_year", "cars", ["make", "model", "year"])
    op.create_index("ix_cars_fuel_type", "cars", ["fuel_type"])
    op.create_index("ix_cars_body_type", "cars", ["body_type"])

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("email", sa.String(255), nullable=False, unique=True, index=True),
        sa.Column("hashed_password", sa.String(255)),
        sa.Column("full_name", sa.String(255)),
        sa.Column("phone", sa.String(20)),
        sa.Column("role", sa.Enum("buyer", "seller", "dealer", "admin", name="user_role"), default="buyer", nullable=False),
        sa.Column("is_verified", sa.Boolean, default=False, nullable=False),
        sa.Column("is_active", sa.Boolean, default=True, nullable=False),
    )

    op.create_table(
        "dealers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("business_name", sa.String(255), nullable=False),
        sa.Column("city", sa.String(100)),
        sa.Column("state", sa.String(100)),
        sa.Column("gst_number", sa.String(20)),
        sa.Column("is_verified", sa.Boolean, default=False, nullable=False),
        sa.Column("rating", sa.Numeric(3, 2)),
    )

    op.create_table(
        "listings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("car_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("cars.id"), nullable=False),
        sa.Column("seller_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("dealer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("dealers.id"), nullable=True),
        sa.Column("listing_type", sa.Enum("new", "used", name="listing_type"), nullable=False),
        sa.Column("price", sa.Numeric(12, 2), nullable=False),
        sa.Column("negotiable", sa.Boolean, default=False, nullable=False),
        sa.Column("km_driven", sa.Integer),
        sa.Column("registration_year", sa.SmallInteger),
        sa.Column("registration_state", sa.String(50)),
        sa.Column("owners_count", sa.SmallInteger),
        sa.Column("condition", sa.Enum("excellent", "good", "fair", "poor", name="listing_condition")),
        sa.Column("city", sa.String(100)),
        sa.Column("description", sa.Text),
        sa.Column("image_urls", postgresql.JSON, default=list, nullable=False),
        sa.Column("is_active", sa.Boolean, default=True, nullable=False),
        sa.Column("is_featured", sa.Boolean, default=False, nullable=False),
        sa.Column("views_count", sa.Integer, default=0, nullable=False),
        sa.Column("ai_valuation", sa.Numeric(12, 2)),
        sa.Column("ai_valuation_at", sa.DateTime(timezone=True)),
        sa.Column("ai_method", sa.String(64)),
        sa.Column("ai_confidence", sa.String(16)),
        sa.Column("ai_reasoning", sa.Text),
    )
    op.create_index("ix_listings_city_type", "listings", ["city", "listing_type"])
    op.create_index("ix_listings_car_id", "listings", ["car_id"])
    op.create_index("ix_listings_seller_id", "listings", ["seller_id"])
    op.create_index("ix_listings_active_featured", "listings", ["is_active", "is_featured"])
    op.create_index("ix_listings_price", "listings", ["price"])
    op.create_index("ix_listings_created_at", "listings", ["created_at"])

    op.create_table(
        "test_drive_bookings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("listings.id"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("preferred_date", sa.Date),
        sa.Column("preferred_time", sa.Time),
        sa.Column("status", sa.Enum("pending", "confirmed", "cancelled", "completed", name="booking_status"), default="pending", nullable=False),
        sa.Column("notes", sa.Text),
    )

    op.create_table(
        "loan_inquiries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("listings.id"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("loan_amount", sa.Numeric(12, 2)),
        sa.Column("tenure_months", sa.SmallInteger),
        sa.Column("employment_type", sa.Enum("salaried", "self_employed", "business", name="employment_type")),
        sa.Column("annual_income", sa.Numeric(12, 2)),
        sa.Column("status", sa.Enum("submitted", "processing", "approved", "rejected", name="loan_status"), default="submitted", nullable=False),
        sa.Column("partner_ref", sa.String(100)),
    )

    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("type", sa.Enum(
            "booking_received", "booking_confirmed", "booking_cancelled",
            "loan_inquiry_received", "price_drop", "listing_viewed", "system",
            name="notification_type",
        ), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("body", sa.Text),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("listings.id"), nullable=True),
        sa.Column("is_read", sa.Boolean, default=False, nullable=False),
    )

    op.create_table(
        "price_alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("listings.id"), nullable=False),
        sa.UniqueConstraint("user_id", "listing_id", name="uq_price_alert_user_listing"),
    )

    op.create_table(
        "reviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("reviewer_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("seller_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("listings.id"), nullable=True),
        sa.Column("booking_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("test_drive_bookings.id"), nullable=True),
        sa.Column("rating", sa.SmallInteger, nullable=False),
        sa.Column("title", sa.String(200)),
        sa.Column("body", sa.Text),
        sa.Column("is_verified", sa.Boolean, default=False, nullable=False),
        sa.UniqueConstraint("reviewer_id", "listing_id", name="uq_review_reviewer_listing"),
        sa.CheckConstraint("rating >= 1 AND rating <= 5", name="ck_review_rating_range"),
    )

    op.create_table(
        "payments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("listing_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("listings.id"), nullable=True),
        sa.Column("amount_paise", sa.Integer, nullable=False),
        sa.Column("currency", sa.String(3), default="INR", nullable=False),
        sa.Column("status", sa.Enum("pending", "paid", "failed", "refunded", name="payment_status"), default="pending", nullable=False),
        sa.Column("purpose", sa.Enum("featured_listing", "subscription_pro", "subscription_dealer", name="payment_purpose"), nullable=False),
        sa.Column("razorpay_order_id", sa.String(100)),
        sa.Column("razorpay_payment_id", sa.String(100)),
    )

    op.create_table(
        "subscriptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("tier", sa.Enum("free", "pro", "dealer", name="subscription_tier"), default="free", nullable=False),
        sa.Column("valid_until", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("user_id", name="uq_subscription_user"),
    )


def downgrade() -> None:
    op.drop_table("subscriptions")
    op.drop_table("payments")
    op.drop_table("reviews")
    op.drop_table("price_alerts")
    op.drop_table("notifications")
    op.drop_table("loan_inquiries")
    op.drop_table("test_drive_bookings")
    op.drop_table("listings")
    op.drop_table("dealers")
    op.drop_table("users")
    op.drop_table("cars")

    for enum_name in reversed(_ENUM_NAMES):
        op.execute(sa.text(f"DROP TYPE IF EXISTS {enum_name} CASCADE"))
