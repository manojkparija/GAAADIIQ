-- GAADIIQ Database Setup - Batch 4: Analytics & Customer Activity Tables
-- Execute this in Supabase SQL Editor AFTER Batch 1
-- These tables track customer behavior for analytics and lead scoring

-- ============================================================================
-- ANALYTICS TABLES
-- ============================================================================

-- Table: customer_activities
-- Tracks all user actions for analytics and behavior tracking
CREATE TABLE IF NOT EXISTS customer_activities (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_type varchar(50) NOT NULL,
    listing_id uuid REFERENCES listings(id) ON DELETE SET NULL,
    car_id bigint REFERENCES cars(id) ON DELETE SET NULL,
    metadata jsonb,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_customer_activities_user_id ON customer_activities(user_id);
CREATE INDEX IF NOT EXISTS ix_customer_activities_activity_type ON customer_activities(activity_type);
CREATE INDEX IF NOT EXISTS ix_customer_activities_listing_id ON customer_activities(listing_id);
CREATE INDEX IF NOT EXISTS ix_customer_activities_created_at ON customer_activities(created_at);

-- Table: customer_intent_scores
-- Calculates lead quality and buyer intent for each customer
-- Used for lead grading and prioritization
CREATE TABLE IF NOT EXISTS customer_intent_scores (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Browse metrics
    total_searches integer DEFAULT 0,
    unique_makes_viewed integer DEFAULT 0,
    unique_models_viewed integer DEFAULT 0,
    repeat_listing_views integer DEFAULT 0,
    search_frequency_score float DEFAULT 0,

    -- Engagement metrics
    total_listing_views integer DEFAULT 0,
    total_brochure_downloads integer DEFAULT 0,
    test_drives_scheduled integer DEFAULT 0,
    loan_inquiries_submitted integer DEFAULT 0,

    -- Conversion metrics
    avg_time_on_listing_seconds integer DEFAULT 0,
    days_since_last_activity integer,

    -- Scoring
    lead_grade varchar(5) DEFAULT 'D',
    intent_score float DEFAULT 0,
    predicted_conversion_probability float DEFAULT 0,

    -- Timestamps
    calculated_at timestamp with time zone NOT NULL DEFAULT now(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_customer_intent_scores_user_id ON customer_intent_scores(user_id);
CREATE INDEX IF NOT EXISTS ix_customer_intent_scores_lead_grade ON customer_intent_scores(lead_grade);
CREATE INDEX IF NOT EXISTS ix_customer_intent_scores_intent_score ON customer_intent_scores(intent_score);
CREATE INDEX IF NOT EXISTS ix_customer_intent_scores_calculated_at ON customer_intent_scores(calculated_at);

-- ============================================================================
-- VEHICLE DIAGNOSIS TABLES
-- ============================================================================

-- Table: vehicle_diagnoses
-- AI-powered vehicle health and valuation analysis
CREATE TABLE IF NOT EXISTS vehicle_diagnoses (
    id uuid PRIMARY KEY,
    listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Diagnosis state
    status varchar(50) DEFAULT 'initiated',
    ai_engine varchar(60),

    -- Vehicle condition assessment
    condition_score float,
    depreciation_percent float,
    estimated_value_inr integer,

    -- Health metrics
    accident_history varchar(20),
    service_records_available boolean,
    insurance_status varchar(50),
    mileage_assessment varchar(50),
    engine_health varchar(50),
    transmission_health varchar(50),
    suspension_health varchar(50),

    -- Detailed analysis
    exterior_condition jsonb,
    interior_condition jsonb,
    mechanical_report jsonb,

    -- Valuation breakdown
    valuation_factors jsonb,

    -- Timeline
    initiated_at timestamp with time zone NOT NULL DEFAULT now(),
    completed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_vehicle_diagnoses_listing_id ON vehicle_diagnoses(listing_id);
CREATE INDEX IF NOT EXISTS ix_vehicle_diagnoses_user_id ON vehicle_diagnoses(user_id);
CREATE INDEX IF NOT EXISTS ix_vehicle_diagnoses_status ON vehicle_diagnoses(status);

-- Table: diagnosis_conversations
-- Multi-turn conversation history for diagnosis sessions
CREATE TABLE IF NOT EXISTS diagnosis_conversations (
    id uuid PRIMARY KEY,
    diagnosis_id uuid NOT NULL REFERENCES vehicle_diagnoses(id) ON DELETE CASCADE,

    role varchar(20),
    message text NOT NULL,

    -- For voice inputs
    is_voice boolean DEFAULT FALSE,
    voice_transcript_id uuid,

    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_diagnosis_conversations_diagnosis_id ON diagnosis_conversations(diagnosis_id);
CREATE INDEX IF NOT EXISTS ix_diagnosis_conversations_created_at ON diagnosis_conversations(created_at);

-- Table: voice_transcripts
-- Speech-to-text results for diagnosis interactions
CREATE TABLE IF NOT EXISTS voice_transcripts (
    id uuid PRIMARY KEY,
    diagnosis_id uuid NOT NULL REFERENCES vehicle_diagnoses(id) ON DELETE CASCADE,

    audio_file_key varchar(512),
    transcript text NOT NULL,
    confidence_score float,

    stt_provider varchar(50),
    stt_model varchar(100),
    processing_time_ms integer,

    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_voice_transcripts_diagnosis_id ON voice_transcripts(diagnosis_id);
CREATE INDEX IF NOT EXISTS ix_voice_transcripts_created_at ON voice_transcripts(created_at);

-- Table: diagnosis_audit_events
-- Audit trail of all diagnosis operations and data changes
CREATE TABLE IF NOT EXISTS diagnosis_audit_events (
    id uuid PRIMARY KEY,
    diagnosis_id uuid NOT NULL REFERENCES vehicle_diagnoses(id) ON DELETE CASCADE,

    event_type varchar(100) NOT NULL,
    actor_id uuid REFERENCES users(id) ON DELETE SET NULL,

    changes_before jsonb,
    changes_after jsonb,

    created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_diagnosis_audit_events_diagnosis_id ON diagnosis_audit_events(diagnosis_id);
CREATE INDEX IF NOT EXISTS ix_diagnosis_audit_events_event_type ON diagnosis_audit_events(event_type);
CREATE INDEX IF NOT EXISTS ix_diagnosis_audit_events_created_at ON diagnosis_audit_events(created_at);
