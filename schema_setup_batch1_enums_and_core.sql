-- GAADIIQ Database Setup - Batch 1: Enum Types & Core Tables
-- Execute this in Supabase SQL Editor
-- This batch creates enum types and core tables with no external dependencies
--
-- ⚠️  SUPERSEDED for cars and listings. DO NOT RUN THOSE TWO SECTIONS.
--
-- The cars and listings definitions below do not match the application's
-- models. They name the same concepts differently (listings.price_inr vs
-- price, mileage vs km_driven, year vs registration_year, location vs city,
-- views vs views_count), omit columns the models require, and key cars by
-- bigserial where the application uses uuid.
--
-- Because both this file and alembic use "create only if absent", whichever
-- ran first won and neither corrected the other. In the deployed database
-- this file won, and every read of a listing failed with "column
-- listings.price does not exist" until migration 0017 repaired it.
--
-- apps/api/alembic is the schema of record: it runs automatically on every
-- API start, so these tables need no manual step at all. Running the cars or
-- listings sections below on a fresh database will reintroduce that outage.

-- ============================================================================
-- PHASE 1: CREATE ENUM TYPES
-- ============================================================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ingestion_status') THEN
        CREATE TYPE ingestion_status AS ENUM ('pending', 'processing', 'completed', 'failed');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'media_kind') THEN
        CREATE TYPE media_kind AS ENUM ('unknown', 'exterior', 'interior', 'colour_swatch', 'feature', 'logo');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'media_view') THEN
        CREATE TYPE media_view AS ENUM ('unknown', 'front', 'front_three_quarter', 'side', 'rear_three_quarter', 'rear', 'top', 'detail');
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'image_category') THEN
        CREATE TYPE image_category AS ENUM (
            'exterior_front', 'exterior_rear', 'exterior_left', 'exterior_right',
            'front_quarter', 'rear_quarter', 'interior_dashboard', 'steering',
            'infotainment', 'seats', 'boot_space', 'engine_bay', 'wheels', 'sunroof',
            'safety', 'accessories', 'gallery', 'three_sixty', 'video'
        );
    END IF;
END $$;

-- ============================================================================
-- PHASE 2: CREATE CORE TABLES (NO EXTERNAL DEPENDENCIES)
-- ============================================================================

-- Table: cars
CREATE TABLE IF NOT EXISTS cars (
    id bigserial PRIMARY KEY,
    make varchar(120) NOT NULL,
    model varchar(120) NOT NULL,
    variant varchar(160),
    year_from integer,
    year_to integer,
    fuel_type varchar(40),
    transmission varchar(40),
    body_type varchar(40),
    seats integer,
    cc integer,
    mileage varchar(50),
    features jsonb,
    specs jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_cars_make ON cars(make);
CREATE INDEX IF NOT EXISTS ix_cars_model ON cars(model);
CREATE INDEX IF NOT EXISTS ix_cars_make_model ON cars(make, model);

-- ============================================================================
-- PHASE 3: CREATE TABLES DEPENDING ON USERS (users must exist first)
-- ============================================================================

-- Table: dealers
CREATE TABLE IF NOT EXISTS dealers (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    business_name varchar(255) NOT NULL,
    business_type varchar(100),
    license_number varchar(100),
    is_verified boolean DEFAULT FALSE NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_dealers_user_id ON dealers(user_id);
CREATE INDEX IF NOT EXISTS ix_dealers_business_name ON dealers(business_name);

-- Table: listings (depends on cars, users, dealers)
CREATE TABLE IF NOT EXISTS listings (
    id uuid PRIMARY KEY,
    car_id bigint NOT NULL REFERENCES cars(id),
    seller_id uuid NOT NULL REFERENCES users(id),
    dealer_id uuid REFERENCES dealers(id),
    title varchar(255) NOT NULL,
    description text,
    price_inr integer NOT NULL,
    mileage integer,
    year integer,
    location varchar(255),
    listing_type varchar(20),
    condition varchar(20),
    is_featured boolean DEFAULT FALSE,
    views integer DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_listings_car_id ON listings(car_id);
CREATE INDEX IF NOT EXISTS ix_listings_seller_id ON listings(seller_id);
CREATE INDEX IF NOT EXISTS ix_listings_dealer_id ON listings(dealer_id);
CREATE INDEX IF NOT EXISTS ix_listings_price ON listings(price_inr);
CREATE INDEX IF NOT EXISTS ix_listings_created_at ON listings(created_at);
CREATE INDEX IF NOT EXISTS ix_listings_is_featured ON listings(is_featured);

-- Table: refresh_tokens (depends on users)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash varchar(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    revoked_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS ix_refresh_tokens_expires_at ON refresh_tokens(expires_at);
