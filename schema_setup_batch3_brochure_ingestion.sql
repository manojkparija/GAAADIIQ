-- GAADIIQ Database Setup - Batch 3: Brochure Ingestion & Media Tables
-- Execute this in Supabase SQL Editor AFTER Batch 1 & 2
-- These are the critical tables for PDF upload/brochure ingestion feature

-- ============================================================================
-- BROCHURE INGESTION PIPELINE TABLES
-- ============================================================================

-- Table: pdf_ingestion_jobs
-- Tracks each uploaded brochure PDF and its processing status
CREATE TABLE IF NOT EXISTS pdf_ingestion_jobs (
    id uuid PRIMARY KEY,
    source_pdf_name varchar(500) NOT NULL,
    source_pdf_key varchar(512),
    file_size_bytes integer,
    status ingestion_status NOT NULL DEFAULT 'pending',
    error_message text,
    page_count integer NOT NULL DEFAULT 0,
    image_count integer NOT NULL DEFAULT 0,
    vehicle_count integer NOT NULL DEFAULT 0,
    ai_engine varchar(60),
    uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    completed_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS ix_pdf_jobs_status ON pdf_ingestion_jobs(status);
CREATE INDEX IF NOT EXISTS ix_pdf_jobs_uploaded_by ON pdf_ingestion_jobs(uploaded_by);
CREATE INDEX IF NOT EXISTS ix_pdf_jobs_created_at ON pdf_ingestion_jobs(created_at);

-- Table: extracted_vehicles
-- Vehicles extracted from PDFs by AI, pending admin review
CREATE TABLE IF NOT EXISTS extracted_vehicles (
    id uuid PRIMARY KEY,
    make varchar(120),
    model varchar(120),
    variant varchar(160),
    model_year integer,
    price_inr integer,
    fuel_type varchar(40),
    transmission varchar(40),
    body_type varchar(40),
    colours jsonb,
    specs jsonb,
    features jsonb,
    confidence float NOT NULL DEFAULT 0,
    review_status varchar(20) NOT NULL DEFAULT 'pending',
    job_id uuid NOT NULL REFERENCES pdf_ingestion_jobs(id) ON DELETE CASCADE,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_extracted_vehicles_job ON extracted_vehicles(job_id);
CREATE INDEX IF NOT EXISTS ix_extracted_vehicles_make_model ON extracted_vehicles(make, model);
CREATE INDEX IF NOT EXISTS ix_extracted_vehicles_review_status ON extracted_vehicles(review_status);

-- Table: vehicle_media
-- Individual images extracted from brochures with comprehensive metadata
CREATE TABLE IF NOT EXISTS vehicle_media (
    id uuid PRIMARY KEY,
    storage_key varchar(512) NOT NULL UNIQUE,
    content_type varchar(100) NOT NULL DEFAULT 'image/png',
    size_bytes integer NOT NULL DEFAULT 0,
    width integer,
    height integer,
    thumbnail_key varchar(512),
    view media_view NOT NULL DEFAULT 'unknown',
    source_pdf_name varchar(500) NOT NULL,
    page_number integer,
    kind media_kind NOT NULL DEFAULT 'unknown',
    make varchar(120),
    model varchar(120),
    variant varchar(160),
    colour varchar(80),
    model_year integer,
    category varchar(40),
    content_hash varchar(64),
    phash varchar(64),
    extracted_vehicle_id uuid REFERENCES extracted_vehicles(id) ON DELETE SET NULL,
    image_category image_category,
    fuel_type varchar(40),
    transmission varchar(40),
    is_primary boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0,
    alt_text varchar(300),
    seo_keywords varchar(500),
    ai_description text,
    source varchar(200),
    copyright varchar(200),
    license varchar(100),
    exif jsonb,
    uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
    enriched_at timestamp with time zone,
    job_id uuid REFERENCES pdf_ingestion_jobs(id) ON DELETE CASCADE,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Comprehensive indexes for media queries
CREATE INDEX IF NOT EXISTS ix_vehicle_media_make ON vehicle_media(make);
CREATE INDEX IF NOT EXISTS ix_vehicle_media_model ON vehicle_media(model);
CREATE INDEX IF NOT EXISTS ix_vehicle_media_phash ON vehicle_media(phash);
CREATE INDEX IF NOT EXISTS ix_vehicle_media_job ON vehicle_media(job_id);
CREATE INDEX IF NOT EXISTS ix_vehicle_media_created ON vehicle_media(created_at);
CREATE INDEX IF NOT EXISTS ix_vehicle_media_model_year ON vehicle_media(model_year);
CREATE INDEX IF NOT EXISTS ix_vehicle_media_category ON vehicle_media(category);
CREATE INDEX IF NOT EXISTS ix_vehicle_media_content_hash ON vehicle_media(content_hash);
CREATE INDEX IF NOT EXISTS ix_vehicle_media_extracted_vehicle_id ON vehicle_media(extracted_vehicle_id);
CREATE INDEX IF NOT EXISTS ix_vehicle_media_image_category ON vehicle_media(image_category);
CREATE INDEX IF NOT EXISTS ix_vehicle_media_fuel_type ON vehicle_media(fuel_type);
CREATE INDEX IF NOT EXISTS ix_vehicle_media_is_primary ON vehicle_media(is_primary);
CREATE INDEX IF NOT EXISTS ix_vehicle_media_uploaded_by ON vehicle_media(uploaded_by);
CREATE INDEX IF NOT EXISTS ix_vehicle_media_enriched_at ON vehicle_media(enriched_at);

-- Table: listing_media
-- Association table linking listings to vehicle_media images
-- Enables sharing same photo across multiple listings
CREATE TABLE IF NOT EXISTS listing_media (
    listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    media_id uuid NOT NULL REFERENCES vehicle_media(id) ON DELETE CASCADE,
    position integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (listing_id, media_id)
);

CREATE INDEX IF NOT EXISTS ix_listing_media_media_id ON listing_media(media_id);
