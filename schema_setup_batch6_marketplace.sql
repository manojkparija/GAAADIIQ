-- GAADIIQ Database Setup - Batch 6: Roadside Repair Marketplace
-- Execute this in Supabase SQL Editor AFTER Batch 4 (needs vehicle_diagnoses)
-- and Batch 2 (needs payments).
--
-- Backs the mechanic registry, service requests raised from AI Diagnosis, and
-- WhatsApp receipt delivery. Everything here is idempotent — re-running it on a
-- database that already has these objects is a no-op.
--
-- ============================================================================
-- TABLE DEPENDENCIES:
-- - mechanics:          depends on users
-- - service_requests:   depends on users, vehicle_diagnoses, mechanics
-- - whatsapp_messages:  depends on service_requests, payments
-- - payments:           ALTERed to carry the marketplace settlement columns
-- ============================================================================
--
-- A NOTE ON THE AADHAAR COLUMNS
--
-- There is deliberately no column holding an Aadhaar number. Section 29(4) of
-- the Aadhaar Act and the UIDAI Aadhaar Data Vault circulars make a private
-- entity storing raw Aadhaar numbers in its own business database an offence.
-- Registration validates the number (including its Verhoeff check digit) and
-- then keeps only:
--
--   aadhaar_last4 — the display fragment, "XXXX XXXX 1234"
--   aadhaar_hash  — peppered SHA-256, a one-way key that still detects a
--                   duplicate registration
--
-- aadhaar_vault_ref is reserved for a reference into a real Data Vault if the
-- number itself is ever genuinely needed. Do not add a plaintext column here.

-- ============================================================================
-- PHASE 1: ENUM TYPES
-- ============================================================================
-- Native enums rather than varchar, matching how the SQLAlchemy models declare
-- these columns (Enum(..., name="mechanic_status")). Note that `payments` in
-- Batch 2 uses varchar for its own status/purpose — that is a pre-existing
-- inconsistency, and is why the ALTER in Phase 4 needs no type changes.

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mechanic_status') THEN
        CREATE TYPE mechanic_status AS ENUM (
            'pending_verification', 'active', 'suspended', 'rejected'
        );
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_request_status') THEN
        CREATE TYPE service_request_status AS ENUM (
            'open', 'assigned', 'in_progress', 'awaiting_payment',
            'paid', 'completed', 'cancelled'
        );
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'whatsapp_template') THEN
        CREATE TYPE whatsapp_template AS ENUM (
            'payment_receipt', 'mechanic_assigned', 'service_request_raised'
        );
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'whatsapp_status') THEN
        CREATE TYPE whatsapp_status AS ENUM (
            'queued', 'sent', 'delivered', 'read', 'failed'
        );
    END IF;
END $$;

-- ============================================================================
-- PHASE 2: MECHANICS
-- ============================================================================

CREATE TABLE IF NOT EXISTS mechanics (
    id uuid PRIMARY KEY,

    -- Nullable: ops can onboard a mechanic before they ever sign in, so the
    -- login is an attachment rather than the identity of the row.
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,

    -- Identity
    full_name varchar(150) NOT NULL,
    shop_name varchar(200),
    phone varchar(15) NOT NULL UNIQUE,
    whatsapp_phone varchar(15),
    email varchar(255),

    -- Address
    address_line1 varchar(255) NOT NULL,
    address_line2 varchar(255),
    city varchar(100) NOT NULL,
    state varchar(100) NOT NULL,
    area_pincode varchar(6) NOT NULL,

    -- Location. Plain floats, not PostGIS: the matching radius is tens of km,
    -- where a bounding box plus haversine is accurate enough, and it keeps the
    -- SQLite-backed test suite working without an extension.
    latitude double precision,
    longitude double precision,
    service_radius_km integer NOT NULL DEFAULT 15,

    -- KYC. See the module header for why the Aadhaar number is absent.
    pan_number varchar(10) NOT NULL,
    aadhaar_last4 varchar(4) NOT NULL,
    aadhaar_hash varchar(64) NOT NULL UNIQUE,
    aadhaar_vault_ref varchar(64),

    -- Payout
    upi_vpa varchar(120),
    bank_account_last4 varchar(4),
    bank_ifsc varchar(11),

    -- Marketplace state
    status mechanic_status NOT NULL DEFAULT 'pending_verification',
    specialisations json,
    is_available boolean NOT NULL DEFAULT TRUE,
    rating numeric(3,2),
    jobs_completed integer NOT NULL DEFAULT 0,
    verified_at varchar(40),
    rejection_reason text,

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_mechanics_user_id ON mechanics(user_id);
CREATE INDEX IF NOT EXISTS ix_mechanics_phone ON mechanics(phone);
CREATE INDEX IF NOT EXISTS ix_mechanics_area_pincode ON mechanics(area_pincode);
CREATE INDEX IF NOT EXISTS ix_mechanics_latitude ON mechanics(latitude);
CREATE INDEX IF NOT EXISTS ix_mechanics_longitude ON mechanics(longitude);
CREATE INDEX IF NOT EXISTS ix_mechanics_pan_number ON mechanics(pan_number);
CREATE INDEX IF NOT EXISTS ix_mechanics_aadhaar_hash ON mechanics(aadhaar_hash);
CREATE INDEX IF NOT EXISTS ix_mechanics_status ON mechanics(status);

-- The nearest-mechanic query filters on all three together.
CREATE INDEX IF NOT EXISTS ix_mechanics_status_lat_lng
    ON mechanics(status, latitude, longitude);

-- ============================================================================
-- PHASE 3: SERVICE REQUESTS
-- ============================================================================
-- Separate from vehicle_diagnoses on purpose: a diagnosis is an immutable
-- assessment, a request is a transaction with a lifecycle, a mechanic, money
-- and a receipt. One diagnosis can also produce several requests, and a request
-- can exist without one — hence the nullable diagnosis_id.

CREATE TABLE IF NOT EXISTS service_requests (
    id uuid PRIMARY KEY,

    -- Human-facing reference printed on the receipt, e.g. "SR-7F3A21".
    reference varchar(20) NOT NULL UNIQUE,

    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    diagnosis_id uuid REFERENCES vehicle_diagnoses(id) ON DELETE SET NULL,
    mechanic_id uuid REFERENCES mechanics(id) ON DELETE SET NULL,

    -- Vehicle. car_number is stored normalised (uppercase, no spaces).
    car_number varchar(15) NOT NULL,
    manufacturer varchar(100),
    model varchar(100),
    model_year integer,
    fuel_type varchar(30),

    -- Where the car actually is: the browser's live fix at request time, not a
    -- saved address. location_accuracy_m is the reported GPS uncertainty — a
    -- 2km fix is a different dispatch problem to a 10m one.
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    location_accuracy_m double precision,
    address_text varchar(400),
    landmark varchar(200),
    pincode varchar(6),

    -- Callback number and receipt recipient. Held on the request because the
    -- person standing with the car is not always the account holder.
    contact_phone varchar(15),

    -- The problem
    problem_summary text NOT NULL,
    severity varchar(20),
    is_vehicle_drivable boolean,
    photo_urls json,

    -- Quote and settlement, in paise throughout so no float touches money.
    quoted_amount_paise integer,
    final_amount_paise integer,

    status service_request_status NOT NULL DEFAULT 'open',
    assigned_at timestamp with time zone,
    completed_at timestamp with time zone,
    cancelled_reason text,

    -- Straight-line km at assignment time, frozen because the mechanic's own
    -- coordinates can change afterwards.
    matched_distance_km double precision,

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_service_requests_reference ON service_requests(reference);
CREATE INDEX IF NOT EXISTS ix_service_requests_user_id ON service_requests(user_id);
CREATE INDEX IF NOT EXISTS ix_service_requests_diagnosis_id ON service_requests(diagnosis_id);
CREATE INDEX IF NOT EXISTS ix_service_requests_mechanic_id ON service_requests(mechanic_id);
CREATE INDEX IF NOT EXISTS ix_service_requests_car_number ON service_requests(car_number);
CREATE INDEX IF NOT EXISTS ix_service_requests_pincode ON service_requests(pincode);
CREATE INDEX IF NOT EXISTS ix_service_requests_status ON service_requests(status);
CREATE INDEX IF NOT EXISTS ix_service_requests_status_created
    ON service_requests(status, created_at);

-- ============================================================================
-- PHASE 4: PAYMENTS — MARKETPLACE SETTLEMENT COLUMNS
-- ============================================================================
-- amount_paise stays the gross the customer paid. The split is frozen onto the
-- row at capture rather than recomputed on read: the commission rate is a
-- business setting that will change, and a receipt issued last year must keep
-- showing last year's numbers.
--
-- payments.purpose is varchar(50) in Batch 2, so the new 'service_request'
-- value needs no type change.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS
    service_request_id uuid REFERENCES service_requests(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS
    mechanic_id uuid REFERENCES mechanics(id) ON DELETE SET NULL;

-- Basis points (1000 = 10.00%). Integer, not a float percentage, so the paise
-- split reproduces exactly.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS commission_rate_bps integer;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS commission_paise integer;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS mechanic_payout_paise integer;

CREATE INDEX IF NOT EXISTS ix_payments_service_request_id ON payments(service_request_id);
CREATE INDEX IF NOT EXISTS ix_payments_mechanic_id ON payments(mechanic_id);

-- ---------------------------------------------------------------------------
-- Repairs for pre-existing drift between Batch 2 and models/payment.py.
--
-- These are NOT part of the marketplace feature, but a service payment is an
-- ordinary row in `payments`, so it inherits any drift already there. Both
-- fixes are conditional and idempotent: on a database that already matches the
-- model they do nothing.
-- ---------------------------------------------------------------------------

-- models/payment.py declares `currency` NOT NULL, Batch 2 never created it. If
-- the live database is missing it, every INSERT the ORM emits fails — including
-- the existing featured-listing and subscription flows.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'INR';

-- Batch 2 types purpose/status as varchar, but the model declares native enums.
-- Whichever the live database actually has, 'service_request' must be an
-- accepted value: on varchar it already is, and on a native enum it has to be
-- added or the ORM's INSERT is rejected.
--
-- ALTER TYPE ... ADD VALUE inside a transaction block requires PostgreSQL 12+
-- (Supabase is well past that) and the new value cannot be *used* until the
-- transaction commits — which is fine here, since nothing below inserts.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_purpose') THEN
        ALTER TYPE payment_purpose ADD VALUE IF NOT EXISTS 'service_request';
    END IF;
END $$;

-- ============================================================================
-- PHASE 5: WHATSAPP MESSAGES
-- ============================================================================
-- Receipts go out over a third-party API that can fail, retry, or deliver
-- twice. Every send attempt gets a row, written before the outbound call, so a
-- crash mid-request leaves a 'queued' row to retry rather than silence.
--
-- The rendered message body is deliberately not stored — only the template name
-- and its variables, so a receipt carrying a phone number and an amount is not
-- duplicated into a second table with a different retention policy.

CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id uuid PRIMARY KEY,

    -- E.164 digits without the leading '+', as every Indian provider expects.
    to_phone varchar(15) NOT NULL,
    template whatsapp_template NOT NULL,
    variables json,

    service_request_id uuid REFERENCES service_requests(id) ON DELETE SET NULL,
    payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,

    status whatsapp_status NOT NULL DEFAULT 'queued',
    provider varchar(30) NOT NULL DEFAULT 'meta_cloud',
    -- Correlates the provider's delivery webhook back to this row.
    provider_message_id varchar(120),

    -- UNIQUE is the real guarantee that a replayed webhook or a double-tapped
    -- "resend receipt" cannot bill the WhatsApp account twice.
    idempotency_key varchar(120) NOT NULL UNIQUE,

    attempts integer NOT NULL DEFAULT 0,
    last_error text,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_to_phone ON whatsapp_messages(to_phone);
CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_service_request_id
    ON whatsapp_messages(service_request_id);
CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_payment_id ON whatsapp_messages(payment_id);
CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_status ON whatsapp_messages(status);
CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_provider_message_id
    ON whatsapp_messages(provider_message_id);
CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_idempotency_key
    ON whatsapp_messages(idempotency_key);
CREATE INDEX IF NOT EXISTS ix_whatsapp_messages_status_created
    ON whatsapp_messages(status, created_at);

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- Run after applying. Expect three rows, then five, then four.

/*

-- The new tables exist:
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('mechanics', 'service_requests', 'whatsapp_messages')
ORDER BY table_name;

-- The payments columns were added:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'payments'
  AND column_name IN ('service_request_id', 'mechanic_id', 'commission_rate_bps',
                      'commission_paise', 'mechanic_payout_paise')
ORDER BY column_name;

-- The enum types exist:
SELECT typname
FROM pg_type
WHERE typname IN ('mechanic_status', 'service_request_status',
                  'whatsapp_template', 'whatsapp_status')
ORDER BY typname;

-- Nothing here should ever return a column that could hold a full Aadhaar
-- number. aadhaar_last4 (4 chars) and aadhaar_hash (64 chars) are expected;
-- anything wider named after Aadhaar is a bug worth stopping for.
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'mechanics'
  AND column_name LIKE '%aadhaar%'
ORDER BY column_name;

*/
