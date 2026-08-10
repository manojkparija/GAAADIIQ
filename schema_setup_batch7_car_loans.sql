-- GAADIIQ Database Setup - Batch 7: Car Loan Applications
-- Execute this in Supabase SQL Editor AFTER Batch 1 (needs users, cars) and
-- Batch 2 (needs listings).
--
-- Backs the "Apply for a car loan" module: a lender directory with rate cards,
-- PAN-based applications, credit-band assessment, and ranked bank offers.
-- Everything here is idempotent — re-running it is a no-op.
--
-- ============================================================================
-- TABLE DEPENDENCIES
--
--   lending_partners    (no dependencies)
--   lender_rate_slabs   -> lending_partners
--   loan_applications   -> users, cars, listings
--   loan_offers         -> loan_applications, lending_partners
--   credit_checks       -> loan_applications, users
--
-- Distinct from the existing `loan_inquiries` table, which is a lead handed to
-- a used-car seller. That one stays as it is; nothing here touches it.
-- ============================================================================
--
-- A NOTE ON PAN, AND WHY IT DIFFERS FROM AADHAAR
--
-- Batch 6 deliberately stores no Aadhaar number. PAN is different: a loan
-- application is worthless to a lender without it, and a hash cannot be
-- forwarded. So `loan_applications.pan_number` holds the real value.
--
--   pan_number  the number, forwarded to the chosen lender
--   pan_digest  peppered SHA-256, so an applicant's history can be looked up
--               without indexing or scanning the number itself
--
-- The API never returns pan_number. Every response carries ABCDE****F. Treat
-- this column as sensitive: it belongs in the same class as bank details, and
-- anything that widens access to it deserves the same scrutiny.
--
-- A NOTE ON CREDIT SCORES
--
-- `credit_checks` records how a band was arrived at, including attempts that
-- failed. Under the Credit Information Companies (Regulation) Act a bureau may
-- only be queried with the borrower's explicit consent, and
-- loan_applications.credit_consent / _at / _ip are the evidence that it was
-- given. No bureau is connected today; scores are self-declared and every row
-- says so in credit_source. Do not backfill this column with estimates.

-- ============================================================================
-- PHASE 1: ENUM TYPES
-- ============================================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lending_partner_type') THEN
        CREATE TYPE lending_partner_type AS ENUM ('bank', 'nbfc', 'captive');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'credit_band') THEN
        CREATE TYPE credit_band AS ENUM ('excellent', 'good', 'fair', 'poor', 'unknown');
    END IF;
END $$;

-- Named loan_employment_type, not employment_type: Batch 1 already created an
-- `employment_type` enum for loan_inquiries, and reusing it would couple a
-- change made for one feature to the other.
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loan_employment_type') THEN
        CREATE TYPE loan_employment_type AS ENUM ('salaried', 'self_employed', 'business');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loan_vehicle_condition') THEN
        CREATE TYPE loan_vehicle_condition AS ENUM ('new', 'used');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loan_credit_source') THEN
        CREATE TYPE loan_credit_source AS ENUM ('self_declared', 'bureau', 'unavailable');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'loan_application_status') THEN
        CREATE TYPE loan_application_status AS ENUM (
            'draft', 'submitted', 'offers_ready', 'partner_selected',
            'forwarded', 'approved', 'rejected', 'withdrawn', 'disbursed'
        );
    END IF;
END $$;

-- ============================================================================
-- PHASE 2: LENDER DIRECTORY
-- ============================================================================

CREATE TABLE IF NOT EXISTS lending_partners (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(120) NOT NULL,
    slug varchar(60) NOT NULL UNIQUE,
    partner_type lending_partner_type NOT NULL DEFAULT 'bank',
    logo_url varchar(500),

    -- Eligibility gates. An applicant failing one of these is shown the lender
    -- with the reason rather than having it hidden.
    min_loan_amount numeric(12,2) NOT NULL DEFAULT 100000,
    max_loan_amount numeric(12,2) NOT NULL DEFAULT 5000000,
    min_tenure_months smallint NOT NULL DEFAULT 12,
    max_tenure_months smallint NOT NULL DEFAULT 84,
    min_monthly_income numeric(12,2) NOT NULL DEFAULT 15000,
    min_credit_score smallint NOT NULL DEFAULT 650,

    -- Share of the vehicle price the lender will fund; the rest is the buyer's
    -- down payment.
    max_ltv_pct numeric(5,2) NOT NULL DEFAULT 85,
    -- Ceiling on total monthly obligations as a share of income.
    max_foir_pct numeric(5,2) NOT NULL DEFAULT 50,

    finances_used_cars boolean NOT NULL DEFAULT true,
    max_vehicle_age_years smallint NOT NULL DEFAULT 10,

    processing_fee_pct numeric(5,3) NOT NULL DEFAULT 0.5,
    processing_fee_min numeric(10,2) NOT NULL DEFAULT 1000,
    processing_fee_max numeric(10,2) NOT NULL DEFAULT 10000,

    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_lending_partners_is_active ON lending_partners(is_active);

-- One cell of a rate card. employment_type NULL means "any", which is the
-- common case; a typed row overrides it for that employment.
CREATE TABLE IF NOT EXISTS lender_rate_slabs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id uuid NOT NULL REFERENCES lending_partners(id) ON DELETE CASCADE,
    credit_band credit_band NOT NULL,
    employment_type loan_employment_type,
    annual_rate_pct numeric(5,2) NOT NULL,
    max_ltv_pct numeric(5,2),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT uq_rate_slab_partner_band_employment
        UNIQUE (partner_id, credit_band, employment_type)
);

CREATE INDEX IF NOT EXISTS ix_lender_rate_slabs_partner_id ON lender_rate_slabs(partner_id);

-- ============================================================================
-- PHASE 3: APPLICATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS loan_applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reference varchar(20) NOT NULL UNIQUE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- What is being financed. Both nullable: a new car is a catalogue row, a
    -- used one is a listing, and a buyer may be financing a vehicle found
    -- elsewhere. vehicle_price is copied rather than read through the join —
    -- it is what the loan was sized against, and a later catalogue price change
    -- must not restate an existing application.
    car_id uuid REFERENCES cars(id) ON DELETE SET NULL,
    listing_id uuid REFERENCES listings(id) ON DELETE SET NULL,
    vehicle_condition loan_vehicle_condition NOT NULL DEFAULT 'new',
    vehicle_description varchar(200),
    vehicle_year smallint,
    vehicle_price numeric(12,2) NOT NULL,

    applicant_name varchar(150) NOT NULL,
    date_of_birth date,
    mobile varchar(15) NOT NULL,
    email varchar(255),
    city varchar(100),
    pincode varchar(10),

    -- See the note at the top of this file before touching these two.
    pan_number varchar(10) NOT NULL,
    pan_digest varchar(64) NOT NULL,

    employment_type loan_employment_type NOT NULL,
    employer_name varchar(150),
    monthly_income numeric(12,2) NOT NULL,
    existing_emi numeric(12,2) NOT NULL DEFAULT 0,

    down_payment numeric(12,2) NOT NULL DEFAULT 0,
    loan_amount numeric(12,2) NOT NULL,
    tenure_months smallint NOT NULL,

    credit_score smallint,
    credit_band credit_band NOT NULL DEFAULT 'unknown',
    credit_source loan_credit_source NOT NULL DEFAULT 'unavailable',
    credit_checked_at timestamp with time zone,

    -- The consent evidence required before any bureau enquiry.
    credit_consent boolean NOT NULL DEFAULT false,
    credit_consent_at timestamp with time zone,
    credit_consent_ip varchar(45),

    status loan_application_status NOT NULL DEFAULT 'submitted',
    -- Deliberately not a foreign key: offers are regenerated whenever the
    -- application changes, and an FK would either block that or cascade the
    -- applicant's choice away.
    selected_offer_id uuid,
    decision_note text,

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_loan_applications_user_id   ON loan_applications(user_id);
CREATE INDEX IF NOT EXISTS ix_loan_applications_status    ON loan_applications(status);
CREATE INDEX IF NOT EXISTS ix_loan_applications_pan_digest ON loan_applications(pan_digest);
CREATE INDEX IF NOT EXISTS ix_loan_applications_car_id    ON loan_applications(car_id);
CREATE INDEX IF NOT EXISTS ix_loan_applications_listing_id ON loan_applications(listing_id);
CREATE INDEX IF NOT EXISTS ix_loan_applications_user_status
    ON loan_applications(user_id, status);

-- A lender's quote, frozen at the moment it was made. Every figure is stored
-- rather than derived: rate cards change, and an offer that re-priced itself
-- between the buyer reading it and acting on it is the bug this table prevents.
CREATE TABLE IF NOT EXISTS loan_offers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
    partner_id uuid NOT NULL REFERENCES lending_partners(id) ON DELETE CASCADE,

    is_eligible boolean NOT NULL DEFAULT true,
    ineligible_reason varchar(200),

    annual_rate_pct numeric(5,2),
    approved_amount numeric(12,2),
    tenure_months smallint,
    monthly_emi numeric(12,2),
    total_interest numeric(12,2),
    processing_fee numeric(10,2),
    -- Interest plus fees. What the loan actually costs, and what the ranking
    -- sorts on — the lowest headline rate is not always the cheapest loan.
    total_cost numeric(12,2),

    rank integer,
    is_recommended boolean NOT NULL DEFAULT false,

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT uq_loan_offer_application_partner UNIQUE (application_id, partner_id)
);

CREATE INDEX IF NOT EXISTS ix_loan_offers_application_id ON loan_offers(application_id);
CREATE INDEX IF NOT EXISTS ix_loan_offers_partner_id     ON loan_offers(partner_id);

-- Kept even when it fails. The question this table answers is "on what basis,
-- and with whose permission, did we quote this person" — and that has to stay
-- answerable after the application is edited or withdrawn.
CREATE TABLE IF NOT EXISTS credit_checks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id uuid NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pan_digest varchar(64) NOT NULL,

    source loan_credit_source NOT NULL,
    bureau varchar(40),
    score smallint,
    band credit_band NOT NULL DEFAULT 'unknown',
    succeeded boolean NOT NULL DEFAULT false,
    error varchar(300),
    consent_reference varchar(100),

    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_credit_checks_application_id ON credit_checks(application_id);
CREATE INDEX IF NOT EXISTS ix_credit_checks_user_id        ON credit_checks(user_id);
CREATE INDEX IF NOT EXISTS ix_credit_checks_pan_digest     ON credit_checks(pan_digest);

-- ============================================================================
-- PHASE 4: SEED THE LENDER DIRECTORY
-- ============================================================================
--
-- Indicative published rates for Indian auto loans, as advertised. They are a
-- starting point for the comparison table, not a commitment, and they go stale:
-- review them against each lender's own page before relying on them, and keep
-- them current from the admin screens rather than by re-running this file.
--
-- ON CONFLICT DO NOTHING, so re-running never overwrites a rate an admin has
-- since corrected.

INSERT INTO lending_partners
    (name, slug, partner_type, min_loan_amount, max_loan_amount,
     min_tenure_months, max_tenure_months, min_monthly_income, min_credit_score,
     max_ltv_pct, max_foir_pct, finances_used_cars, max_vehicle_age_years,
     processing_fee_pct, processing_fee_min, processing_fee_max, sort_order)
VALUES
    ('State Bank of India', 'sbi',      'bank', 100000, 10000000, 12, 84, 25000, 700, 90, 50, true,  10, 0.400,  1000,  7500,  1),
    ('HDFC Bank',           'hdfc',     'bank', 100000,  7500000, 12, 84, 25000, 700, 90, 50, true,  8,  0.500,  3500, 11000,  2),
    ('ICICI Bank',          'icici',    'bank', 100000,  6500000, 12, 84, 25000, 700, 85, 50, true,  8,  0.500,  3500, 10000,  3),
    ('Axis Bank',           'axis',     'bank', 100000,  5000000, 12, 84, 20000, 690, 85, 50, true,  8,  0.500,  3500,  9000,  4),
    ('Kotak Mahindra Bank', 'kotak',    'bank', 100000,  5000000, 12, 84, 20000, 690, 85, 50, true,  10, 0.500,  2500,  9000,  5),
    ('Bank of Baroda',      'bob',      'bank', 100000,  5000000, 12, 84, 20000, 690, 90, 50, true,  10, 0.250,  1000,  7500,  6),
    ('Punjab National Bank','pnb',      'bank', 100000,  5000000, 12, 84, 20000, 690, 85, 50, true,  10, 0.250,  1000,  6500,  7),
    ('Yes Bank',            'yes',      'bank', 100000,  4000000, 12, 84, 25000, 700, 85, 50, true,  8,  0.750,  3500, 10000,  8),
    ('Cholamandalam Finance','chola',   'nbfc', 100000,  4000000, 12, 72, 15000, 650, 85, 55, true,  12, 1.000,  3000, 15000,  9),
    ('HDB Financial Services','hdb',    'nbfc',  75000,  3000000, 12, 72, 15000, 620, 80, 55, true,  12, 1.500,  3000, 15000, 10),
    ('Maruti Suzuki Finance','maruti-finance','captive', 100000, 3000000, 12, 84, 20000, 680, 90, 50, false, 0, 0.500, 2500, 8000, 11)
ON CONFLICT (slug) DO NOTHING;

-- Rate cards. One row per band; banks price a thin file (`unknown`) at their
-- worst published rate, which is what an applicant who has not had a bureau
-- check is quoted. Self-employed applicants pay a premium at most lenders, so
-- those get their own rows where it applies.
INSERT INTO lender_rate_slabs (partner_id, credit_band, employment_type, annual_rate_pct, max_ltv_pct)
SELECT p.id, v.band::credit_band, v.emp::loan_employment_type, v.rate, v.ltv
FROM lending_partners p
JOIN (VALUES
    -- slug,            band,        employment,      rate,  ltv override
    ('sbi',             'excellent', NULL,             8.45, NULL),
    ('sbi',             'good',      NULL,             8.95, NULL),
    ('sbi',             'fair',      NULL,             9.75, 80),
    ('sbi',             'poor',      NULL,            11.25, 70),
    ('sbi',             'unknown',   NULL,            10.50, 75),
    ('sbi',             'excellent', 'self_employed',  8.95, NULL),

    ('hdfc',            'excellent', NULL,             8.75, NULL),
    ('hdfc',            'good',      NULL,             9.20, NULL),
    ('hdfc',            'fair',      NULL,            10.25, 80),
    ('hdfc',            'poor',      NULL,            12.00, 70),
    ('hdfc',            'unknown',   NULL,            11.00, 75),
    ('hdfc',            'excellent', 'self_employed',  9.25, NULL),

    ('icici',           'excellent', NULL,             8.85, NULL),
    ('icici',           'good',      NULL,             9.35, NULL),
    ('icici',           'fair',      NULL,            10.40, 80),
    ('icici',           'poor',      NULL,            12.25, 70),
    ('icici',           'unknown',   NULL,            11.25, 75),

    ('axis',            'excellent', NULL,             9.00, NULL),
    ('axis',            'good',      NULL,             9.50, NULL),
    ('axis',            'fair',      NULL,            10.60, 80),
    ('axis',            'poor',      NULL,            12.50, 70),
    ('axis',            'unknown',   NULL,            11.50, 75),

    ('kotak',           'excellent', NULL,             8.65, NULL),
    ('kotak',           'good',      NULL,             9.15, NULL),
    ('kotak',           'fair',      NULL,            10.30, 80),
    ('kotak',           'poor',      NULL,            12.10, 70),
    ('kotak',           'unknown',   NULL,            11.10, 75),

    ('bob',             'excellent', NULL,             8.55, NULL),
    ('bob',             'good',      NULL,             9.05, NULL),
    ('bob',             'fair',      NULL,             9.95, 80),
    ('bob',             'poor',      NULL,            11.50, 70),
    ('bob',             'unknown',   NULL,            10.75, 75),

    ('pnb',             'excellent', NULL,             8.70, NULL),
    ('pnb',             'good',      NULL,             9.20, NULL),
    ('pnb',             'fair',      NULL,            10.10, 80),
    ('pnb',             'poor',      NULL,            11.75, 70),
    ('pnb',             'unknown',   NULL,            10.90, 75),

    ('yes',             'excellent', NULL,             9.75, NULL),
    ('yes',             'good',      NULL,            10.25, NULL),
    ('yes',             'fair',      NULL,            11.30, 80),
    ('yes',             'poor',      NULL,            13.00, 70),
    ('yes',             'unknown',   NULL,            12.00, 75),

    ('chola',           'excellent', NULL,            10.50, NULL),
    ('chola',           'good',      NULL,            11.50, NULL),
    ('chola',           'fair',      NULL,            13.00, 80),
    ('chola',           'poor',      NULL,            15.50, 70),
    ('chola',           'unknown',   NULL,            14.00, 75),

    ('hdb',             'excellent', NULL,            11.50, NULL),
    ('hdb',             'good',      NULL,            12.75, NULL),
    ('hdb',             'fair',      NULL,            14.50, 75),
    ('hdb',             'poor',      NULL,            17.00, 65),
    ('hdb',             'unknown',   NULL,            15.50, 70),

    ('maruti-finance',  'excellent', NULL,             8.90, NULL),
    ('maruti-finance',  'good',      NULL,             9.40, NULL),
    ('maruti-finance',  'fair',      NULL,            10.50, 80),
    ('maruti-finance',  'poor',      NULL,            12.25, 70),
    ('maruti-finance',  'unknown',   NULL,            11.40, 75)
) AS v(slug, band, emp, rate, ltv) ON v.slug = p.slug
ON CONFLICT (partner_id, credit_band, employment_type) DO NOTHING;

-- ============================================================================
-- VERIFICATION — run these after the script and read the output
-- ============================================================================
/*

-- Five tables, and the row counts you should expect.
SELECT 'lending_partners'  AS table_name, count(*) FROM lending_partners
UNION ALL SELECT 'lender_rate_slabs',  count(*) FROM lender_rate_slabs
UNION ALL SELECT 'loan_applications',  count(*) FROM loan_applications
UNION ALL SELECT 'loan_offers',        count(*) FROM loan_offers
UNION ALL SELECT 'credit_checks',      count(*) FROM credit_checks;
-- Expect 11 partners and 58 rate slabs on a fresh run; the last three are 0.

-- Every active lender must have a rate for every band, or an applicant in a
-- band it has no row for silently drops out of the comparison.
SELECT p.slug, count(s.id) AS slabs
FROM lending_partners p
LEFT JOIN lender_rate_slabs s ON s.partner_id = p.id
WHERE p.is_active
GROUP BY p.slug
HAVING count(s.id) < 5
ORDER BY p.slug;
-- Expect zero rows.

-- The enum types exist:
SELECT typname FROM pg_type
WHERE typname IN ('lending_partner_type', 'credit_band', 'loan_employment_type',
                  'loan_vehicle_condition', 'loan_credit_source',
                  'loan_application_status')
ORDER BY typname;

-- PAN storage sanity: exactly two pan_* columns, and pan_number no wider than
-- the 10 characters a PAN has. Anything wider is a bug worth stopping for.
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'loan_applications'
  AND column_name LIKE 'pan%'
ORDER BY column_name;

*/
