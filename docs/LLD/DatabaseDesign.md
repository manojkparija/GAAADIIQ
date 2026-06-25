# GAADIIQ.COM — Database Design

**Version:** 1.0  
**Date:** 2026-06-24  
**Database:** PostgreSQL 16 (Supabase)

---

## 1. Design Principles

- All primary keys: UUID v4 (no sequential integer IDs exposed to API)
- All tables: `created_at`, `updated_at` timestamps (auto-managed via trigger)
- Soft deletes: `deleted_at` on mutable data (users, cars, leads)
- Snake_case naming throughout
- Row Level Security (RLS) enabled on sensitive tables

---

## 2. Schema: `brands`

Stores all automobile manufacturer brands.

```sql
CREATE TABLE brands (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL UNIQUE,
    slug            VARCHAR(100) NOT NULL UNIQUE,
    logo_url        TEXT,
    country_of_origin VARCHAR(100),
    founded_year    SMALLINT,
    description     TEXT,
    website_url     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order      SMALLINT DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_brands_slug ON brands(slug);
CREATE INDEX idx_brands_active ON brands(is_active) WHERE is_active = TRUE;
```

**Sample data:** Maruti Suzuki, Tata Motors, Hyundai, Kia, Toyota, Honda, Mahindra, MG Motor, Skoda, Volkswagen, Renault, Nissan, Citroen, Jeep, BYD, Volvo, Mercedes-Benz, BMW, Audi

---

## 3. Schema: `cars`

Top-level model (e.g., "Hyundai Creta", "Tata Nexon").

```sql
CREATE TABLE cars (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id        UUID NOT NULL REFERENCES brands(id),
    name            VARCHAR(150) NOT NULL,
    slug            VARCHAR(150) NOT NULL UNIQUE,
    model_year      SMALLINT NOT NULL,
    body_type       VARCHAR(50) NOT NULL,  -- hatchback, sedan, suv, muv, coupe, convertible
    segment         VARCHAR(50),           -- A, B, B+, C, D, E, F
    description     TEXT,
    highlights      JSONB,                 -- ["5-star NCAP", "Sunroof", "Wireless charging"]
    launch_date     DATE,
    discontinue_date DATE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    is_featured     BOOLEAN NOT NULL DEFAULT FALSE,
    popularity_score DECIMAL(5,2) DEFAULT 0,  -- computed, updated weekly
    seo_title       VARCHAR(200),
    seo_description VARCHAR(500),
    seo_keywords    TEXT[],
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cars_brand_id ON cars(brand_id);
CREATE INDEX idx_cars_slug ON cars(slug);
CREATE INDEX idx_cars_body_type ON cars(body_type);
CREATE INDEX idx_cars_active ON cars(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_cars_featured ON cars(is_featured) WHERE is_featured = TRUE;
```

---

## 4. Schema: `variants`

Specific trim levels of a car (e.g., "Creta E 1.5 Petrol MT").

```sql
CREATE TABLE variants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    car_id          UUID NOT NULL REFERENCES cars(id),
    name            VARCHAR(200) NOT NULL,
    slug            VARCHAR(200) NOT NULL UNIQUE,
    
    -- Pricing
    ex_showroom_price     BIGINT NOT NULL,   -- in paise (₹ × 100) for precision
    on_road_price_delhi   BIGINT,
    on_road_price_mumbai  BIGINT,
    on_road_price_bangalore BIGINT,
    on_road_price_chennai BIGINT,
    on_road_price_hyderabad BIGINT,
    
    -- Fuel & Transmission
    fuel_type       VARCHAR(30) NOT NULL,  -- petrol, diesel, electric, cng, hybrid, mild_hybrid
    transmission    VARCHAR(30) NOT NULL,  -- manual, automatic, amt, cvt, dct, imt
    drive_type      VARCHAR(20) DEFAULT 'fwd',  -- fwd, rwd, awd, 4wd
    
    -- Engine
    engine_displacement_cc  SMALLINT,
    engine_power_bhp        DECIMAL(6,2),
    engine_torque_nm        DECIMAL(6,2),
    engine_cylinders        SMALLINT,
    
    -- EV-specific
    battery_capacity_kwh    DECIMAL(5,2),
    range_km_arai           SMALLINT,
    charging_fast_kw        DECIMAL(5,2),
    charging_time_0_80_min  SMALLINT,
    
    -- Performance
    top_speed_kmph          SMALLINT,
    acceleration_0_100_sec  DECIMAL(4,2),
    mileage_kmpl_arai       DECIMAL(5,2),
    mileage_kmpl_city       DECIMAL(5,2),
    mileage_kmpl_highway    DECIMAL(5,2),
    
    -- Dimensions
    length_mm               SMALLINT,
    width_mm                SMALLINT,
    height_mm               SMALLINT,
    wheelbase_mm            SMALLINT,
    ground_clearance_mm     SMALLINT,
    boot_space_litres       SMALLINT,
    fuel_tank_litres        SMALLINT,
    kerb_weight_kg          SMALLINT,
    
    -- Seating
    seating_capacity        SMALLINT NOT NULL DEFAULT 5,
    
    -- Safety
    ncap_rating_bharat      DECIMAL(2,1),  -- 0.0 to 5.0
    ncap_rating_global      DECIMAL(2,1),
    ncap_year               SMALLINT,
    airbags_count           SMALLINT,
    
    -- Status
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    is_base_variant BOOLEAN NOT NULL DEFAULT FALSE,
    is_top_variant  BOOLEAN NOT NULL DEFAULT FALSE,
    
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_variants_car_id ON variants(car_id);
CREATE INDEX idx_variants_fuel_type ON variants(fuel_type);
CREATE INDEX idx_variants_transmission ON variants(transmission);
CREATE INDEX idx_variants_price ON variants(ex_showroom_price);
CREATE INDEX idx_variants_seating ON variants(seating_capacity);
```

---

## 5. Schema: `features`

Feature taxonomy (sunroof, ABS, cruise control, etc.).

```sql
CREATE TABLE features (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(150) NOT NULL UNIQUE,
    slug            VARCHAR(150) NOT NULL UNIQUE,
    category        VARCHAR(80) NOT NULL,  -- safety, comfort, technology, exterior, interior, performance
    description     TEXT,
    icon_name       VARCHAR(50),
    sort_order      SMALLINT DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE variant_features (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id      UUID NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
    feature_id      UUID NOT NULL REFERENCES features(id),
    availability    VARCHAR(20) NOT NULL DEFAULT 'standard',  -- standard, optional, not_available
    notes           TEXT,
    UNIQUE(variant_id, feature_id)
);

CREATE INDEX idx_variant_features_variant ON variant_features(variant_id);
CREATE INDEX idx_variant_features_feature ON variant_features(feature_id);
```

---

## 6. Schema: `car_images`

```sql
CREATE TABLE car_images (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    car_id          UUID REFERENCES cars(id),
    variant_id      UUID REFERENCES variants(id),
    url             TEXT NOT NULL,           -- Cloudflare R2 URL
    thumbnail_url   TEXT,
    alt_text        VARCHAR(300),
    category        VARCHAR(50) NOT NULL,   -- exterior, interior, colour
    colour_name     VARCHAR(80),
    colour_hex      CHAR(7),
    angle           VARCHAR(50),            -- front, rear, side, 34-front, dashboard
    is_primary      BOOLEAN DEFAULT FALSE,
    sort_order      SMALLINT DEFAULT 0,
    source          VARCHAR(100),           -- "imagin.studio", "Tata Motors Press"
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_car_images_car ON car_images(car_id);
CREATE INDEX idx_car_images_variant ON car_images(variant_id);
CREATE INDEX idx_car_images_primary ON car_images(is_primary) WHERE is_primary = TRUE;
```

---

## 7. Schema: `reviews`

Expert reviews (AI-drafted, manually refined).

```sql
CREATE TABLE reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    car_id          UUID NOT NULL REFERENCES cars(id),
    author_name     VARCHAR(100) NOT NULL DEFAULT 'GAADIIQ Team',
    title           VARCHAR(300) NOT NULL,
    summary         TEXT NOT NULL,
    full_content    TEXT NOT NULL,           -- Markdown
    
    -- Ratings (1.0 to 5.0)
    rating_overall      DECIMAL(2,1) NOT NULL,
    rating_performance  DECIMAL(2,1),
    rating_comfort      DECIMAL(2,1),
    rating_safety       DECIMAL(2,1),
    rating_fuel_economy DECIMAL(2,1),
    rating_features     DECIMAL(2,1),
    rating_value        DECIMAL(2,1),
    
    pros            TEXT[],
    cons            TEXT[],
    verdict         TEXT,
    is_published    BOOLEAN DEFAULT FALSE,
    published_at    TIMESTAMPTZ,
    
    -- SEO
    seo_title       VARCHAR(200),
    seo_description VARCHAR(500),
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reviews_car ON reviews(car_id);
CREATE INDEX idx_reviews_published ON reviews(is_published, published_at);
```

---

## 8. Schema: `users`

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(254) NOT NULL UNIQUE,
    email_verified  BOOLEAN DEFAULT FALSE,
    password_hash   TEXT,                    -- NULL for OAuth-only users
    full_name       VARCHAR(200),
    phone           VARCHAR(20),
    city            VARCHAR(100),
    state           VARCHAR(100),
    role            VARCHAR(20) NOT NULL DEFAULT 'user',  -- user, dealer, admin
    
    -- OAuth
    google_id       VARCHAR(100) UNIQUE,
    
    -- Preferences
    preferred_budget_min  BIGINT,
    preferred_budget_max  BIGINT,
    preferred_fuel_types  TEXT[],
    preferred_body_types  TEXT[],
    
    -- Account
    is_active       BOOLEAN DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,            -- soft delete, anonymise PII
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = TRUE;
```

---

## 9. Schema: `dealers`

```sql
CREATE TABLE dealers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id),
    name            VARCHAR(200) NOT NULL,
    slug            VARCHAR(200) NOT NULL UNIQUE,
    brand_id        UUID REFERENCES brands(id),   -- primary brand they deal
    
    -- Contact
    address         TEXT,
    city            VARCHAR(100) NOT NULL,
    state           VARCHAR(100) NOT NULL,
    pincode         CHAR(6),
    phone           VARCHAR(20),
    email           VARCHAR(254),
    website_url     TEXT,
    google_maps_url TEXT,
    latitude        DECIMAL(9,6),
    longitude       DECIMAL(9,6),
    
    -- Business
    is_verified     BOOLEAN DEFAULT FALSE,
    is_active       BOOLEAN DEFAULT TRUE,
    lead_price_inr  INTEGER DEFAULT 500,          -- cost per lead in ₹
    monthly_budget  INTEGER,                       -- lead budget cap
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dealers_brand ON dealers(brand_id);
CREATE INDEX idx_dealers_city ON dealers(city);
CREATE INDEX idx_dealers_location ON dealers(latitude, longitude);
CREATE INDEX idx_dealers_active ON dealers(is_active) WHERE is_active = TRUE;
```

---

## 10. Schema: `leads`

All lead types: dealer enquiry, test drive, loan, insurance.

```sql
CREATE TYPE lead_type AS ENUM ('dealer_enquiry', 'test_drive', 'loan', 'insurance');
CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'qualified', 'converted', 'lost', 'spam');

CREATE TABLE leads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_type       lead_type NOT NULL,
    status          lead_status NOT NULL DEFAULT 'new',
    
    -- Buyer info
    buyer_name      VARCHAR(200) NOT NULL,
    buyer_email     VARCHAR(254) NOT NULL,
    buyer_phone     VARCHAR(20) NOT NULL,
    buyer_city      VARCHAR(100),
    user_id         UUID REFERENCES users(id),     -- if logged in
    
    -- Car interest
    car_id          UUID REFERENCES cars(id),
    variant_id      UUID REFERENCES variants(id),
    preferred_colour VARCHAR(80),
    budget_min      BIGINT,
    budget_max      BIGINT,
    
    -- Routing
    dealer_id       UUID REFERENCES dealers(id),
    
    -- Test drive specific
    preferred_date  DATE,
    preferred_time_slot VARCHAR(20),
    confirmed_date  DATE,
    
    -- Loan specific
    loan_amount     BIGINT,
    loan_tenure_months SMALLINT,
    employment_type VARCHAR(50),
    
    -- Tracking
    source_page     TEXT,                    -- URL of page lead was submitted from
    utm_source      VARCHAR(100),
    utm_medium      VARCHAR(100),
    utm_campaign    VARCHAR(100),
    intent_score    SMALLINT,               -- 1-100, computed at capture time
    
    -- Admin
    notes           TEXT,
    contacted_at    TIMESTAMPTZ,
    converted_at    TIMESTAMPTZ,
    
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leads_type ON leads(lead_type);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_dealer ON leads(dealer_id);
CREATE INDEX idx_leads_car ON leads(car_id);
CREATE INDEX idx_leads_created ON leads(created_at DESC);
```

---

## 11. Schema: `recommendations`

Stores AI recommendation sessions for analytics.

```sql
CREATE TABLE recommendations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL,            -- browser session
    user_id         UUID REFERENCES users(id),
    
    -- Inputs
    budget_min      BIGINT,
    budget_max      BIGINT,
    city            VARCHAR(100),
    fuel_preference TEXT[],
    body_type_preference TEXT[],
    seating_min     SMALLINT,
    usage_type      VARCHAR(50),              -- city, highway, mixed, offroad
    safety_priority SMALLINT,                 -- 1-5
    maintenance_priority SMALLINT,
    family_size     SMALLINT,
    
    -- Outputs
    recommended_car_ids UUID[],
    engine_used     VARCHAR(30),              -- rule_engine, llm, hybrid
    match_scores    JSONB,                    -- {car_id: score, ...}
    explanation     TEXT,
    llm_model       VARCHAR(50),
    latency_ms      INTEGER,
    
    -- Feedback
    user_selected_car_id UUID REFERENCES cars(id),
    user_rating     SMALLINT,                -- 1-5 thumbs on recommendation
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recommendations_session ON recommendations(session_id);
CREATE INDEX idx_recommendations_user ON recommendations(user_id);
CREATE INDEX idx_recommendations_created ON recommendations(created_at DESC);
```

---

## 12. Schema: `wishlists`

```sql
CREATE TABLE wishlists (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    car_id      UUID NOT NULL REFERENCES cars(id),
    variant_id  UUID REFERENCES variants(id),
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, car_id)
);

CREATE INDEX idx_wishlists_user ON wishlists(user_id);
```

---

## 13. Schema: `ownership_cost_cache`

Pre-computed TCO snapshots (refreshed weekly).

```sql
CREATE TABLE ownership_cost_cache (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id      UUID NOT NULL REFERENCES variants(id) UNIQUE,
    
    -- Annual costs (in paise)
    annual_fuel_cost_city     BIGINT,
    annual_fuel_cost_highway  BIGINT,
    annual_insurance_yr1      BIGINT,
    annual_insurance_yr2_5    BIGINT,
    annual_maintenance_cost   BIGINT,
    
    -- 5-year totals
    total_fuel_5yr            BIGINT,
    total_insurance_5yr       BIGINT,
    total_maintenance_5yr     BIGINT,
    depreciation_5yr          BIGINT,    -- lost value
    resale_value_5yr          BIGINT,    -- estimated resale
    tco_5yr                   BIGINT,    -- grand total
    
    -- Assumptions used
    km_per_year               INTEGER DEFAULT 15000,
    city_fuel_price_per_litre INTEGER,   -- in paise
    highway_fuel_price_per_litre INTEGER,
    loan_interest_rate        DECIMAL(4,2),
    computed_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 14. Schema: `analytics_events`

Lightweight event store for product analytics.

```sql
CREATE TABLE analytics_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_name  VARCHAR(100) NOT NULL,   -- car_viewed, search_performed, comparison_started, lead_submitted
    session_id  UUID,
    user_id     UUID REFERENCES users(id),
    properties  JSONB,                   -- {car_id, query, filters, ...}
    page_url    TEXT,
    user_agent  TEXT,
    ip_hash     CHAR(64),                -- SHA-256 hash, not raw IP (privacy)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Monthly partitions (created by migration script)
CREATE TABLE analytics_events_2026_06 PARTITION OF analytics_events
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE INDEX idx_events_name ON analytics_events(event_name);
CREATE INDEX idx_events_session ON analytics_events(session_id);
CREATE INDEX idx_events_created ON analytics_events(created_at DESC);
```

---

## 15. Shared Trigger: `updated_at`

```sql
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Applied to: brands, cars, variants, reviews, users, dealers, leads, ownership_cost_cache
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON {table_name}
FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

---

## 16. Row Level Security Policies

```sql
-- Users can only see their own data
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_own_data ON users
    FOR ALL USING (id = current_setting('app.current_user_id')::UUID OR
                   current_setting('app.current_user_role') = 'admin');

-- Leads: dealers see only their own leads
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY leads_dealer_access ON leads
    FOR SELECT USING (
        dealer_id IN (
            SELECT id FROM dealers
            WHERE user_id = current_setting('app.current_user_id')::UUID
        ) OR current_setting('app.current_user_role') = 'admin'
    );
```

---

*See also: [ERDiagram.md](ERDiagram.md)*
