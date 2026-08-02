-- GAADIIQ Database Setup - Batch 5: Final Constraints & Verification
-- Execute this in Supabase SQL Editor AFTER all other batches
-- Adds remaining unique constraints and indexes

-- ============================================================================
-- ADD UNIQUE CONSTRAINTS (if not already present)
-- ============================================================================

-- Ensure one dealer profile per user
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='dealers' AND constraint_name='uq_dealer_user_id'
    ) THEN
        ALTER TABLE dealers ADD CONSTRAINT uq_dealer_user_id UNIQUE (user_id);
    END IF;
END $$;

-- Ensure one subscription per user
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='subscriptions' AND constraint_name='uq_subscription_user'
    ) THEN
        ALTER TABLE subscriptions ADD CONSTRAINT uq_subscription_user UNIQUE (user_id);
    END IF;
END $$;

-- Prevent duplicate price alerts for same user/listing combo
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='price_alerts' AND constraint_name='uq_price_alert_user_listing'
    ) THEN
        ALTER TABLE price_alerts ADD CONSTRAINT uq_price_alert_user_listing UNIQUE (user_id, listing_id);
    END IF;
END $$;

-- Prevent duplicate reviews for same reviewer/listing combo
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name='reviews' AND constraint_name='uq_review_reviewer_listing'
    ) THEN
        ALTER TABLE reviews ADD CONSTRAINT uq_review_reviewer_listing UNIQUE (reviewer_id, listing_id);
    END IF;
END $$;

-- ============================================================================
-- ADD MISSING FOREIGN KEY INDEXES (for query performance)
-- ============================================================================

-- Listings queries by dealer
CREATE INDEX IF NOT EXISTS ix_listings_dealer_id ON listings(dealer_id);

-- Test drive booking queries
CREATE INDEX IF NOT EXISTS ix_test_drive_bookings_listing_id ON test_drive_bookings(listing_id);
CREATE INDEX IF NOT EXISTS ix_test_drive_bookings_user_id ON test_drive_bookings(user_id);

-- Review queries
CREATE INDEX IF NOT EXISTS ix_reviews_listing_id ON reviews(listing_id);
CREATE INDEX IF NOT EXISTS ix_reviews_seller_id ON reviews(seller_id);

-- Notification queries
CREATE INDEX IF NOT EXISTS ix_notifications_listing_id ON notifications(listing_id);

-- ============================================================================
-- VERIFY SCHEMA COMPLETENESS
-- ============================================================================

-- Run these queries manually to verify all tables exist:
/*

-- Check all tables exist:
SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
ORDER BY table_name;

-- Expected tables (20 total):
-- 1. cars
-- 2. customer_activities
-- 3. customer_intent_scores
-- 4. dealers
-- 5. diagnosis_audit_events
-- 6. diagnosis_conversations
-- 7. extracted_vehicles
-- 8. listings
-- 9. listing_media
-- 10. loan_inquiries
-- 11. notifications
-- 12. payments
-- 13. pdf_ingestion_jobs
-- 14. price_alerts
-- 15. refresh_tokens
-- 16. reviews
-- 17. subscriptions
-- 18. test_drive_bookings
-- 19. users
-- 20. vehicle_diagnoses
-- 21. vehicle_media
-- 22. voice_transcripts

-- Check all enum types exist:
SELECT typname FROM pg_type
WHERE typkind='e'
ORDER BY typname;

-- Expected enums (7 total):
-- 1. body_type
-- 2. booking_status
-- 3. employment_type
-- 4. fuel_type
-- 5. image_category
-- 6. ingestion_status
-- 7. listing_condition
-- 8. listing_type
-- 9. loan_status
-- 10. media_kind
-- 11. media_view
-- 12. notification_type
-- 13. payment_purpose
-- 14. payment_status
-- 15. subscription_tier
-- 16. transmission
-- 17. user_role

-- Check indexes exist:
SELECT schemaname, tablename, indexname FROM pg_indexes
WHERE schemaname='public'
ORDER BY tablename, indexname;

-- Check unique constraints:
SELECT constraint_name, table_name
FROM information_schema.table_constraints
WHERE table_schema='public' AND constraint_type='UNIQUE'
ORDER BY table_name, constraint_name;

-- Check foreign keys:
SELECT
    constraint_name,
    table_name,
    column_name,
    referenced_table_name,
    referenced_column_name
FROM information_schema.key_column_usage
WHERE table_schema='public'
  AND referenced_table_name IS NOT NULL
ORDER BY table_name, constraint_name;

*/
