# Phase 4 — Database Setup

**Status:** In Progress  
**Date:** 2026-06-25  
**Database:** PostgreSQL via Supabase Free Tier  
**ORM:** SQLAlchemy 2.x (async)  
**Migrations:** Alembic

---

## Entity Overview

| Entity | Purpose |
|---|---|
| `users` | Registered buyers, sellers, and admins |
| `dealers` | Verified dealership profiles |
| `cars` | Master car catalogue (make/model/variant metadata) |
| `listings` | Individual car listings (new or used) |
| `test_drive_bookings` | Test drive requests tied to a listing |
| `loan_inquiries` | Loan/finance lead capture for affiliate revenue |

---

## Schema Design

### `users`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | default gen_random_uuid() |
| email | VARCHAR(255) UNIQUE NOT NULL | login identifier |
| hashed_password | VARCHAR(255) | null for OAuth users |
| full_name | VARCHAR(255) | |
| phone | VARCHAR(20) | |
| role | ENUM('buyer','seller','dealer','admin') | default 'buyer' |
| is_verified | BOOLEAN | default false |
| is_active | BOOLEAN | default true |
| created_at | TIMESTAMPTZ | default now() |
| updated_at | TIMESTAMPTZ | auto-updated |

### `dealers`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| user_id | UUID FK → users.id | one dealer per user account |
| business_name | VARCHAR(255) NOT NULL | |
| city | VARCHAR(100) | |
| state | VARCHAR(100) | |
| gst_number | VARCHAR(20) | |
| is_verified | BOOLEAN | admin-verified |
| rating | NUMERIC(3,2) | 0.00–5.00 |
| created_at | TIMESTAMPTZ | |

### `cars` (catalogue)
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| make | VARCHAR(100) NOT NULL | e.g. "Maruti Suzuki" |
| model | VARCHAR(100) NOT NULL | e.g. "Swift" |
| variant | VARCHAR(100) | e.g. "ZXi+" |
| year | SMALLINT NOT NULL | manufacture year |
| fuel_type | ENUM('petrol','diesel','electric','cng','hybrid') | |
| transmission | ENUM('manual','automatic','amt','cvt','dct') | |
| body_type | ENUM('hatchback','sedan','suv','muv','coupe','convertible') | |
| seating_capacity | SMALLINT | |
| engine_cc | SMALLINT | engine displacement |
| created_at | TIMESTAMPTZ | |

**Indexes:** `(make, model, year)`, `(fuel_type)`, `(body_type)`

### `listings`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| car_id | UUID FK → cars.id | |
| seller_id | UUID FK → users.id | individual or dealer user |
| dealer_id | UUID FK → dealers.id NULLABLE | set if seller is dealer |
| listing_type | ENUM('new','used') | |
| price | NUMERIC(12,2) NOT NULL | INR |
| negotiable | BOOLEAN | default false |
| km_driven | INTEGER | null for new cars |
| registration_year | SMALLINT | |
| registration_state | VARCHAR(10) | e.g. "MH", "DL" |
| owners_count | SMALLINT | number of previous owners |
| condition | ENUM('excellent','good','fair','poor') | |
| city | VARCHAR(100) | |
| description | TEXT | |
| is_active | BOOLEAN | default true |
| is_featured | BOOLEAN | default false (sponsored) |
| views_count | INTEGER | default 0 |
| ai_valuation | NUMERIC(12,2) | AI-predicted fair price |
| ai_valuation_at | TIMESTAMPTZ | when AI valued it |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**Indexes:** `(city, listing_type)`, `(car_id)`, `(seller_id)`, `(is_active, is_featured)`, `(price)`, `(created_at DESC)`

### `test_drive_bookings`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| listing_id | UUID FK → listings.id | |
| user_id | UUID FK → users.id | who wants the test drive |
| preferred_date | DATE | |
| preferred_time | TIME | |
| status | ENUM('pending','confirmed','cancelled','completed') | |
| notes | TEXT | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### `loan_inquiries`
| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| listing_id | UUID FK → listings.id | |
| user_id | UUID FK → users.id | |
| loan_amount | NUMERIC(12,2) | |
| tenure_months | SMALLINT | 12 / 24 / 36 / 60 |
| employment_type | ENUM('salaried','self_employed','business') | |
| annual_income | NUMERIC(12,2) | |
| status | ENUM('submitted','processing','approved','rejected') | |
| partner_ref | VARCHAR(100) | affiliate tracking ID |
| created_at | TIMESTAMPTZ | |

---

## Relationships

```
users ──< listings (as seller)
users ──< test_drive_bookings
users ──< loan_inquiries
users ──○ dealers (1:1)
dealers ──< listings
cars ──< listings
listings ──< test_drive_bookings
listings ──< loan_inquiries
```

---

## Design Decisions

1. **UUID PKs** — avoids sequential ID enumeration, safe for public APIs.
2. **TIMESTAMPTZ** — all timestamps in UTC with timezone.
3. **Async SQLAlchemy** — non-blocking DB calls with `asyncpg` driver.
4. **Soft deletes** — `is_active` flag rather than hard deletes for listings and users.
5. **AI valuation columns on listings** — avoids a separate table; valuation is per-listing not per-car-model.
6. **Alembic for migrations** — version-controlled schema changes, no manual SQL.
7. **Supabase** — managed PostgreSQL, built-in connection pooling (PgBouncer), free 500MB.

---

## Next: Phase 5
Auth module — JWT login/register, password hashing, NextAuth integration on frontend.
