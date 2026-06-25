# GAADIIQ.COM — Entity Relationship Diagram

**Version:** 1.0  
**Date:** 2026-06-24

---

## 1. Full ER Diagram (Mermaid ERD)

```mermaid
erDiagram
    brands {
        UUID id PK
        string name
        string slug
        string logo_url
        string country_of_origin
        int founded_year
        bool is_active
    }

    cars {
        UUID id PK
        UUID brand_id FK
        string name
        string slug
        int model_year
        string body_type
        string segment
        bool is_active
        bool is_featured
        decimal popularity_score
        string seo_title
        string seo_description
    }

    variants {
        UUID id PK
        UUID car_id FK
        string name
        string slug
        bigint ex_showroom_price
        string fuel_type
        string transmission
        int engine_displacement_cc
        decimal engine_power_bhp
        decimal mileage_kmpl_arai
        int seating_capacity
        decimal ncap_rating_bharat
        int airbags_count
        bool is_active
    }

    features {
        UUID id PK
        string name
        string slug
        string category
        string description
    }

    variant_features {
        UUID id PK
        UUID variant_id FK
        UUID feature_id FK
        string availability
    }

    car_images {
        UUID id PK
        UUID car_id FK
        UUID variant_id FK
        string url
        string category
        string angle
        bool is_primary
    }

    reviews {
        UUID id PK
        UUID car_id FK
        string title
        decimal rating_overall
        string[] pros
        string[] cons
        bool is_published
    }

    users {
        UUID id PK
        string email
        string password_hash
        string full_name
        string phone
        string city
        string role
        bool is_active
    }

    dealers {
        UUID id PK
        UUID user_id FK
        UUID brand_id FK
        string name
        string city
        string state
        bool is_verified
        int lead_price_inr
    }

    leads {
        UUID id PK
        enum lead_type
        enum status
        UUID user_id FK
        UUID car_id FK
        UUID variant_id FK
        UUID dealer_id FK
        string buyer_name
        string buyer_email
        string buyer_phone
        int intent_score
    }

    wishlists {
        UUID id PK
        UUID user_id FK
        UUID car_id FK
        UUID variant_id FK
    }

    recommendations {
        UUID id PK
        UUID user_id FK
        UUID[] recommended_car_ids
        string engine_used
        text explanation
        int latency_ms
    }

    ownership_cost_cache {
        UUID id PK
        UUID variant_id FK
        bigint tco_5yr
        bigint depreciation_5yr
        bigint resale_value_5yr
        bigint annual_fuel_cost_city
        bigint annual_insurance_yr1
    }

    analytics_events {
        UUID id PK
        UUID user_id FK
        string event_name
        jsonb properties
        timestamp created_at
    }

    brands ||--o{ cars : "manufactures"
    cars ||--o{ variants : "has"
    cars ||--o{ car_images : "has"
    cars ||--o{ reviews : "has"
    cars ||--o{ leads : "interest in"
    cars ||--o{ wishlists : "saved in"

    variants ||--o{ variant_features : "has"
    variants ||--o{ car_images : "has"
    variants ||--o{ leads : "specific interest"
    variants ||--o{ wishlists : "saved"
    variants ||--|| ownership_cost_cache : "has TCO"

    features ||--o{ variant_features : "listed in"

    users ||--o{ leads : "submits"
    users ||--o{ wishlists : "owns"
    users ||--o{ recommendations : "receives"
    users ||--o{ analytics_events : "generates"
    users ||--o| dealers : "manages"

    dealers ||--o{ leads : "receives"
    brands ||--o{ dealers : "authorises"
```

---

## 2. Relationship Summary

| Relationship | Cardinality | Notes |
|---|---|---|
| Brand → Cars | 1:N | One brand has many car models |
| Car → Variants | 1:N | One model has 2–15 variants |
| Car → Images | 1:N | Multiple images per model/variant |
| Car → Reviews | 1:N | One expert review per model (typically) |
| Variant → Features | M:N | Via `variant_features` join table |
| Variant → OwnershipCost | 1:1 | Pre-computed TCO per variant |
| User → Leads | 1:N | User can submit multiple leads |
| User → Wishlists | 1:N | User can shortlist many cars |
| User → Dealer | 1:1 | Optional — dealer users have a dealers record |
| Dealer → Leads | 1:N | Dealer receives many leads |
| Brand → Dealers | 1:N | Brand has many authorised dealers |

---

## 3. Index Strategy Summary

| Table | Index | Type | Purpose |
|---|---|---|---|
| `brands` | `slug` | BTREE UNIQUE | URL routing |
| `cars` | `brand_id` | BTREE | Brand filter |
| `cars` | `slug` | BTREE UNIQUE | URL routing |
| `cars` | `body_type` | BTREE | Body type filter |
| `variants` | `car_id` | BTREE | Car → variants |
| `variants` | `fuel_type` | BTREE | Fuel filter |
| `variants` | `ex_showroom_price` | BTREE | Price sort/filter |
| `leads` | `dealer_id` | BTREE | Dealer dashboard |
| `leads` | `created_at DESC` | BTREE | Recent leads |
| `analytics_events` | `created_at DESC` | BTREE (partitioned) | Time-series queries |
| `dealers` | `(latitude, longitude)` | BTREE | Geo proximity queries |

---

## 4. Data Volume Estimates (Year 1)

| Table | Expected Rows | Storage Est. |
|---|---|---|
| `brands` | 25 | < 1 MB |
| `cars` | 150 | < 5 MB |
| `variants` | 500 | < 20 MB |
| `features` | 200 | < 1 MB |
| `variant_features` | 25,000 | < 10 MB |
| `car_images` | 3,000 | < 5 MB (URLs only) |
| `reviews` | 150 | < 10 MB |
| `users` | 100,000 | < 50 MB |
| `dealers` | 500 | < 1 MB |
| `leads` | 50,000 | < 20 MB |
| `wishlists` | 200,000 | < 30 MB |
| `recommendations` | 500,000 | < 100 MB |
| `analytics_events` | 5,000,000 | < 250 MB |
| **Total** | | **~500 MB** |

This fits within **Supabase Free Tier (500MB)** for Year 1. Analytics events partitioned and older partitions archived to Cloudflare R2 if needed.

---

*Part of Phase 2 LLD. See: [DatabaseDesign.md](DatabaseDesign.md) | [APIContracts.md](APIContracts.md)*
