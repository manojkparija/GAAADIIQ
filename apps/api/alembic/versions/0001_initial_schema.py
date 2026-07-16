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


def upgrade() -> None:
    # ── Enums ──────────────────────────────────────────────────────────────────
    fuel_type = postgresql.ENUM(
        "petrol", "diesel", "electric", "cng", "hybrid", name="fuel_type", create_type=False
    )
    fuel_type.create(op.get_bind(), checkfirst=True)

    transmission = postgresql.ENUM(
        "manual", "automatic", "amt", "cvt", "dct", name="transmission", create_type=False
    )
    transmission.create(op.get_bind(), checkfirst=True)

    body_type = postgresql.ENUM(
        "hatchback", "sedan", "suv", "muv", "coupe", "convertible", name="body_type", create_type=False
    )
    body_type.create(op.get_bind(), checkfirst=True)

    user_role = postgresql.ENUM(
        "buyer", "seller", "dealer", "admin", name="user_role", create_type=False
    )
    user_role.create(op.get_bind(), checkfirst=True)

    listing_type = postgresql.ENUM("new", "used", name="listing_type", create_type=False)
    listing_type.create(op.get_bind(), checkfirst=True)

    listing_condition = postgresql.ENUM(
        "excellent", "good", "fair", "poor", name="listing_condition", create_type=False
    )
    listing_condition.create(op.get_bind(), checkfirst=True)

    booking_status = postgresql.ENUM(
        "pending", "confirmed", "cancelled", "completed", name="booking_status", create_type=False
    )
    booking_status.create(op.get_bind(), checkfirst=True)

    loan_status = postgresql.ENUM(
        "submitted", "processing", "approved", "rejected", name="loan_status", create_type=False
    )
    loan_status.create(op.get_bind(), checkfirst=True)

    employment_type = postgresql.ENUM(
        "salaried", "self_employed", "business", name="employment_type", create_type=False
    )
    employment_type.create(op.get_bind(), checkfirst=True)

    notification_type = postgresql.ENUM(
        "booking_received", "booking_confirmed", "booking_cancelled",
        "loan_inquiry_received", "price_drop", "listing_viewed", "system",
        name="notification_type", create_type=False,
    )
    notification_type.create(op.get_bind(), checkfirst=True)

    payment_status = postgresql.ENUM(
        "pending", "paid", "failed", "refunded", name="payment_status", create_type=False
    )
    payment_status.create(op.get_bind(), checkfirst=True)

    payment_purpose = postgresql.ENUM(
        "featured_listing", "subscription_pro", "subscription_dealer",
        name="payment_purpose", create_type=False,
    )
    payment_purpose.create(op.get_bind(), checkfirst=True)

    subscription_tier = postgresql.ENUM(
        "free", "pro", "dealer", name="subscription_tier", create_type=False
    )
    subscription_tier.create(op.get_bind(), checkfirst=True)

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

    for enum_name in [
        "subscription_tier", "payment_purpose", "payment_status", "notification_type",
        "employment_type", "loan_status", "booking_status", "listing_condition",
        "listing_type", "user_role", "body_type", "transmission", "fuel_type",
    ]:
        sa.Enum(name=enum_name).drop(op.get_bind(), checkfirst=True)
