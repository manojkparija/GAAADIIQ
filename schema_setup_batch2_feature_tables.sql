-- GAADIIQ Database Setup - Batch 2: Feature Tables
-- Execute this in Supabase SQL Editor AFTER Batch 1
-- These tables depend on users and/or listings

-- ============================================================================
-- TABLE DEPENDENCIES:
-- - notifications: depends on users, listings
-- - test_drive_bookings: depends on users, listings
-- - loan_inquiries: depends on users, listings
-- - price_alerts: depends on users, listings
-- - reviews: depends on users, listings
-- - payments: depends on users, listings
-- - subscriptions: depends on users
-- ============================================================================

-- Table: notifications
CREATE TABLE IF NOT EXISTS notifications (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id uuid REFERENCES listings(id) ON DELETE CASCADE,
    type varchar(50) NOT NULL,
    title varchar(255) NOT NULL,
    message text,
    is_read boolean DEFAULT FALSE,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS ix_notifications_listing_id ON notifications(listing_id);
CREATE INDEX IF NOT EXISTS ix_notifications_created_at ON notifications(created_at);
CREATE INDEX IF NOT EXISTS ix_notifications_is_read ON notifications(is_read);

-- Table: test_drive_bookings
CREATE TABLE IF NOT EXISTS test_drive_bookings (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    booking_date timestamp with time zone NOT NULL,
    status varchar(20) DEFAULT 'pending',
    notes text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_test_drive_bookings_user_id ON test_drive_bookings(user_id);
CREATE INDEX IF NOT EXISTS ix_test_drive_bookings_listing_id ON test_drive_bookings(listing_id);
CREATE INDEX IF NOT EXISTS ix_test_drive_bookings_booking_date ON test_drive_bookings(booking_date);
CREATE INDEX IF NOT EXISTS ix_test_drive_bookings_status ON test_drive_bookings(status);

-- Table: loan_inquiries
CREATE TABLE IF NOT EXISTS loan_inquiries (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    loan_amount integer,
    tenure_months integer,
    employment_type varchar(40),
    monthly_income integer,
    status varchar(20) DEFAULT 'submitted',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_loan_inquiries_user_id ON loan_inquiries(user_id);
CREATE INDEX IF NOT EXISTS ix_loan_inquiries_listing_id ON loan_inquiries(listing_id);
CREATE INDEX IF NOT EXISTS ix_loan_inquiries_status ON loan_inquiries(status);

-- Table: price_alerts
CREATE TABLE IF NOT EXISTS price_alerts (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    target_price integer,
    is_active boolean DEFAULT TRUE,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_price_alerts_user_id ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS ix_price_alerts_listing_id ON price_alerts(listing_id);
CREATE INDEX IF NOT EXISTS ix_price_alerts_is_active ON price_alerts(is_active);

-- Add unique constraint to prevent duplicate alerts
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='price_alerts' AND constraint_name='uq_price_alert_user_listing'
    ) THEN
        ALTER TABLE price_alerts ADD CONSTRAINT uq_price_alert_user_listing UNIQUE (user_id, listing_id);
    END IF;
END $$;

-- Table: reviews
CREATE TABLE IF NOT EXISTS reviews (
    id uuid PRIMARY KEY,
    reviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    seller_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    booking_id uuid,
    rating integer CHECK (rating >= 1 AND rating <= 5),
    title varchar(255),
    comment text,
    is_verified_purchase boolean DEFAULT FALSE,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_reviews_reviewer_id ON reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS ix_reviews_listing_id ON reviews(listing_id);
CREATE INDEX IF NOT EXISTS ix_reviews_seller_id ON reviews(seller_id);
CREATE INDEX IF NOT EXISTS ix_reviews_rating ON reviews(rating);

-- Add unique constraint to prevent duplicate reviews
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='reviews' AND constraint_name='uq_review_reviewer_listing'
    ) THEN
        ALTER TABLE reviews ADD CONSTRAINT uq_review_reviewer_listing UNIQUE (reviewer_id, listing_id);
    END IF;
END $$;

-- Table: payments
CREATE TABLE IF NOT EXISTS payments (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id uuid REFERENCES listings(id) ON DELETE SET NULL,
    amount_paise integer NOT NULL,
    status varchar(20) DEFAULT 'pending',
    purpose varchar(50),
    razorpay_order_id varchar(255),
    razorpay_payment_id varchar(255),
    razorpay_signature varchar(255),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS ix_payments_listing_id ON payments(listing_id);
CREATE INDEX IF NOT EXISTS ix_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS ix_payments_razorpay_order ON payments(razorpay_order_id);

-- Table: subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    tier varchar(20) DEFAULT 'free',
    is_active boolean DEFAULT TRUE,
    stripe_customer_id varchar(255),
    stripe_subscription_id varchar(255),
    auto_renew boolean DEFAULT TRUE,
    started_at timestamp with time zone NOT NULL DEFAULT now(),
    expires_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS ix_subscriptions_tier ON subscriptions(tier);
CREATE INDEX IF NOT EXISTS ix_subscriptions_is_active ON subscriptions(is_active);
