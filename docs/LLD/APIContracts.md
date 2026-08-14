# GAADIIQ.COM — API Contracts

**Version:** 2.0
**Date:** 2026-08-14
**Base URL (production):** `https://gaadiiq-api.onrender.com`

> **Corrected 2026-08-14.** v1.0 documented 42 endpoints. Ten of them still
> exist. The service now exposes **164 endpoints across 29 routers**, so 154
> were undocumented and 32 documented paths (`/brands`, `/variants/{id}`,
> `/leads/*`, `/users/me/wishlists`, `/ownership-cost/*`, `/compare`,
> `/admin/analytics/*` …) do not exist.
>
> Section 1 is generated from the router decorators and is therefore accurate by
> construction. Section 2 keeps v1.0's request and response shapes as a
> historical appendix — treat any individual shape there as unverified, and read
> the live OpenAPI schema at `/docs` for the current one.

---

## 0. Conventions

- **Auth.** Supabase issues the JWT. The Angular `auth.interceptor` attaches it
  to every request aimed at `environment.apiUrl` — never set the header by hand.
  The API verifies it against Supabase's JWKS.
- **Tier.** Free vs premium is resolved from the verified token, never from the
  request body.
- **Rate limits.** `slowapi`, declared per endpoint. `/diagnosis/analyse` is
  5/minute and 20/hour and requires no authentication at all.
- **Errors.** FastAPI's default `{"detail": ...}`.
- **Source of truth.** `/docs` (Swagger) and `/openapi.json` on the running
  service. This file is a map, not a contract.

---

## 1. Endpoint inventory (generated from `routers/`)


**`/admin`** — `routers/admin.py` · 5 endpoints

```
GET    /admin/listings
GET    /admin/stats
GET    /admin/users
PATCH  /admin/listings/{listing_id}/deactivate
PATCH  /admin/users/{user_id}
```

**`/admin/diagnosis-kb`** — `routers/diagnosis_kb.py` · 11 endpoints

```
GET    /admin/diagnosis-kb/cache/stats
GET    /admin/diagnosis-kb/import-history
GET    /admin/diagnosis-kb/review-history
GET    /admin/diagnosis-kb/review-queue
GET    /admin/diagnosis-kb/review-queue/summary
GET    /admin/diagnosis-kb/review-queue/{diagnosis_id}
GET    /admin/diagnosis-kb/stats
POST   /admin/diagnosis-kb/cache/invalidate
POST   /admin/diagnosis-kb/import
POST   /admin/diagnosis-kb/review/solution/{solution_id}
POST   /admin/diagnosis-kb/review/{diagnosis_id}
```

**`/auth`** — `routers/auth.py` · 8 endpoints

```
DELETE /auth/me
GET    /auth/me
POST   /auth/forgot-password
POST   /auth/login
POST   /auth/logout
POST   /auth/refresh
POST   /auth/register
POST   /auth/reset-password
```

**`/auth/otp`** — `routers/otp.py` · 2 endpoints

```
POST   /auth/otp/send
POST   /auth/otp/verify
```

**`/bookings`** — `routers/bookings.py` · 4 endpoints

```
GET    /bookings
GET    /bookings/received
PATCH  /bookings/{booking_id}/status
POST   /bookings
```

**`/brochures`** — `routers/brochures.py` · 7 endpoints

```
DELETE /brochures/jobs/{job_id}
GET    /brochures/images
GET    /brochures/jobs
GET    /brochures/jobs/{job_id}
POST   /brochures/backfill
POST   /brochures/tag-images
POST   /brochures/upload
```

**`/cars`** — `routers/cars.py` · 11 endpoints

```
DELETE /cars/{car_id}/variants/{variant_id}
GET    /cars
GET    /cars/catalogue/options
GET    /cars/{car_id}
GET    /cars/{car_id}/variants
PATCH  /cars/{car_id}
PATCH  /cars/{car_id}/variants/{variant_id}
POST   /cars
POST   /cars/{car_id}/research-details
POST   /cars/{car_id}/variants
POST   /cars/{car_id}/variants/research
```

**`/dealers`** — `routers/dealers.py` · 6 endpoints

```
GET    /dealers/directory
GET    /dealers/me
GET    /dealers/me/analytics
GET    /dealers/my-listings-summary
PATCH  /dealers/me
POST   /dealers/register
```

**`/diagnosis`** — `routers/diagnosis.py` · 9 endpoints

```
DELETE /diagnosis/voice/data
DELETE /diagnosis/{diagnosis_id}
GET    /diagnosis/history
GET    /diagnosis/{diagnosis_id}
POST   /diagnosis/analyse
POST   /diagnosis/stt
POST   /diagnosis/tts
POST   /diagnosis/voice/consent
POST   /diagnosis/voice/extract
```

**`/health`** — `routers/health.py` · 1 endpoints

```
GET    /health
```

**`/insurance`** — `routers/insurance.py` · 2 endpoints

```
POST   /insurance/enquiry
POST   /insurance/quotes
```

**`/listings`** — `routers/listings.py` · 9 endpoints

```
DELETE /listings/{listing_id}
GET    /listings
GET    /listings/me
GET    /listings/{listing_id}
GET    /listings/{listing_id}/similar
PATCH  /listings/{listing_id}
POST   /listings
POST   /listings/{listing_id}/images
POST   /listings/{listing_id}/valuate
```

**`/loans`** — `routers/loan_applications.py` · 9 endpoints

```
GET    /loans/admin/applications
GET    /loans/applications
GET    /loans/applications/{application_id}
GET    /loans/applications/{application_id}/offers
GET    /loans/partners
POST   /loans/applications
POST   /loans/applications/{application_id}/credit-check
POST   /loans/applications/{application_id}/select
POST   /loans/applications/{application_id}/withdraw
```

**`/loans`** — `routers/loans.py` · 6 endpoints

```
GET    /loans/bank-rates
GET    /loans/emi-calculator
GET    /loans/inquiries
GET    /loans/inquiries/received
GET    /loans/inquiries/{inquiry_id}
POST   /loans/inquiries
```

**`/mechanics`** — `routers/mechanics.py` · 7 endpoints

```
GET    /mechanics
GET    /mechanics/me
GET    /mechanics/nearby
GET    /mechanics/{mechanic_id}
PATCH  /mechanics/{mechanic_id}/availability
PATCH  /mechanics/{mechanic_id}/verify
POST   /mechanics
```

**`/media-admin`** — `routers/media_admin.py` · 13 endpoints

```
DELETE /media-admin/{media_id}
GET    /media-admin/dealer-images
GET    /media-admin/search
GET    /media-admin/vehicle-images
GET    /media-admin/{media_id}/audit
GET    /media-admin/{media_id}/ocr
GET    /media-admin/{media_id}/safety
GET    /media-admin/{media_id}/versions
PATCH  /media-admin/{media_id}
POST   /media-admin/inspect
POST   /media-admin/upload
POST   /media-admin/{media_id}/restore
POST   /media-admin/{media_id}/versions/{version_id}/rollback
```

**`/news`** — `routers/news.py` · 1 endpoints

```
GET    /news
```

**`/notifications`** — `routers/notifications.py` · 4 endpoints

```
GET    /notifications
GET    /notifications/unread-count
PATCH  /notifications/{notification_id}/read
POST   /notifications/mark-all-read
```

**`/payments`** — `routers/payments.py` · 5 endpoints

```
GET    /payments/my
POST   /payments/feature-listing
POST   /payments/verify
POST   /payments/webhook
POST   /payments/{payment_id}/refund
```

**`/price-alerts`** — `routers/price_alerts.py` · 4 endpoints

```
DELETE /price-alerts/{alert_id}
GET    /price-alerts
GET    /price-alerts/listing/{listing_id}/subscribed
POST   /price-alerts
```

**`/recommend`** — `routers/recommend.py` · 3 endpoints

```
POST   /recommend
POST   /recommend/ai
POST   /recommend/ai-chat
```

**`/resale`** — `routers/resale.py` · 1 endpoints

```
POST   /resale/forecast
```

**`/reviews`** — `routers/reviews.py` · 6 endpoints

```
DELETE /reviews/{review_id}
GET    /reviews/listing/{listing_id}
GET    /reviews/my
GET    /reviews/seller/{seller_id}
GET    /reviews/seller/{seller_id}/summary
POST   /reviews
```

**`/search`** — `routers/search.py` · 2 endpoints

```
GET    /search
GET    /search/autocomplete
```

**`/sentiment`** — `routers/sentiment.py` · 6 endpoints

```
GET    /sentiment/leads
GET    /sentiment/leads/{user_id}
GET    /sentiment/summary
POST   /sentiment/analyse/{user_id}
POST   /sentiment/track
POST   /sentiment/track-public
```

**`/service-requests`** — `routers/service_requests.py` · 18 endpoints

```
GET    /service-requests
GET    /service-requests/assigned-to-me
GET    /service-requests/offers/available
GET    /service-requests/{request_id}
GET    /service-requests/{request_id}/mechanics
GET    /service-requests/{request_id}/start-otp
POST   /service-requests
POST   /service-requests/{request_id}/accept
POST   /service-requests/{request_id}/assign
POST   /service-requests/{request_id}/cancel
POST   /service-requests/{request_id}/complete
POST   /service-requests/{request_id}/decline
POST   /service-requests/{request_id}/dispatch
POST   /service-requests/{request_id}/pay
POST   /service-requests/{request_id}/pay/verify
POST   /service-requests/{request_id}/quote
POST   /service-requests/{request_id}/start
POST   /service-requests/{request_id}/verify-start-otp
```

**`/upload`** — `routers/upload.py` · 4 endpoints

```
POST   /upload
POST   /upload/audio
POST   /upload/image
POST   /upload/video
```

<!-- total 164 -->


---

## 2. Appendix — v1.0 request/response shapes (historical, unverified)

Everything below is the previous version of this document, kept because the
payload shapes for the endpoints that survived are still a useful starting
point. Ten of the paths it describes exist; the rest do not.

<details>
<summary>Expand v1.0</summary>

# GAADIIQ.COM — API Contracts

**Version:** 1.0  
**Date:** 2026-06-24  
**Base URL:** `https://api.gaadiiq.com/api/v1`  
**Auth:** Bearer JWT in `Authorization` header (where noted)  
**Format:** All requests/responses: `application/json`

---

## Conventions

- `🔓` Public endpoint (no auth required)
- `🔐` Authenticated user required
- `👮` Admin role required
- `🏪` Dealer role required
- Prices always in **paise** (1 ₹ = 100 paise) — divide by 100 for display
- Pagination: `?page=1&per_page=20` — response includes `total`, `page`, `per_page`, `pages`
- Errors: `{"detail": "message", "code": "ERROR_CODE"}`

---

## 1. Health

### `GET /health` 🔓
```json
// Response 200
{"status": "ok", "version": "1.0.0", "environment": "production"}
```

### `GET /health/ready` 🔓
```json
// Response 200
{"db": true, "redis": true, "search": true, "ai": true}
// Response 503 (if any service down)
{"db": true, "redis": false, "search": true, "ai": true}
```

---

## 2. Brands

### `GET /brands` 🔓
List all active brands.

```json
// Response 200
{
  "data": [
    {
      "id": "uuid",
      "name": "Maruti Suzuki",
      "slug": "maruti-suzuki",
      "logo_url": "https://cdn.gaadiiq.com/brands/maruti-suzuki.svg",
      "country_of_origin": "Japan",
      "car_count": 15
    }
  ],
  "total": 19
}
```

### `GET /brands/{slug}` 🔓
```json
// Response 200
{
  "id": "uuid",
  "name": "Tata Motors",
  "slug": "tata-motors",
  "logo_url": "...",
  "description": "...",
  "website_url": "https://www.tatamotors.com",
  "founded_year": 1945,
  "cars": [
    {"id": "uuid", "name": "Nexon", "slug": "tata-nexon", "starting_price": 800000, "body_type": "suv"}
  ]
}
```

---

## 3. Cars

### `GET /cars` 🔓
List cars with filters.

**Query params:**
| Param | Type | Example |
|---|---|---|
| `brand` | string | `tata-motors` |
| `body_type` | string | `suv,hatchback` |
| `fuel_type` | string | `petrol,electric` |
| `transmission` | string | `automatic` |
| `price_min` | integer | `600000` |
| `price_max` | integer | `2000000` |
| `seating_min` | integer | `6` |
| `ncap_min` | number | `4.0` |
| `sort` | string | `price_asc`, `price_desc`, `popularity`, `rating` |
| `page` | integer | `1` |
| `per_page` | integer | `20` |

```json
// Response 200
{
  "data": [
    {
      "id": "uuid",
      "name": "Tata Nexon",
      "slug": "tata-nexon",
      "brand": {"name": "Tata Motors", "slug": "tata-motors"},
      "body_type": "suv",
      "starting_price": 800000,
      "max_price": 1600000,
      "fuel_types": ["petrol", "diesel"],
      "primary_image": "https://cdn.gaadiiq.com/cars/tata-nexon/front.webp",
      "ncap_rating": 5.0,
      "popularity_score": 92.5,
      "variant_count": 12
    }
  ],
  "total": 48,
  "page": 1,
  "per_page": 20,
  "pages": 3
}
```

### `GET /cars/{slug}` 🔓
Full car detail.

```json
// Response 200
{
  "id": "uuid",
  "name": "Hyundai Creta",
  "slug": "hyundai-creta",
  "brand": {"name": "Hyundai", "slug": "hyundai", "logo_url": "..."},
  "model_year": 2024,
  "body_type": "suv",
  "segment": "B+",
  "description": "...",
  "highlights": ["5-Star NCAP", "Panoramic Sunroof", "ADAS Level 2"],
  "starting_price": 1100000,
  "max_price": 2000000,
  "images": [
    {"url": "...", "angle": "front", "is_primary": true},
    {"url": "...", "angle": "rear"}
  ],
  "variants": [
    {
      "id": "uuid",
      "name": "E 1.5 Petrol MT",
      "ex_showroom_price": 1100000,
      "fuel_type": "petrol",
      "transmission": "manual",
      "engine_power_bhp": 115.0,
      "mileage_kmpl_arai": 17.4,
      "seating_capacity": 5,
      "is_base_variant": true
    }
  ],
  "review": {
    "rating_overall": 4.3,
    "summary": "...",
    "pros": ["Spacious cabin", "Excellent features"],
    "cons": ["Petrol mileage could be better"]
  },
  "seo_title": "Hyundai Creta 2024 Price, Specs, Review | GAADIIQ",
  "seo_description": "..."
}
```

---

## 4. Variants

### `GET /variants/{id}` 🔓
Full variant detail with all specs.

```json
// Response 200
{
  "id": "uuid",
  "car": {"id": "uuid", "name": "Tata Nexon", "slug": "tata-nexon"},
  "name": "Creative+ S Petrol MT",
  "ex_showroom_price": 1250000,
  "on_road_price_delhi": 1450000,
  "fuel_type": "petrol",
  "transmission": "manual",
  "drive_type": "fwd",
  "engine": {
    "displacement_cc": 1497,
    "power_bhp": 118.4,
    "torque_nm": 170,
    "cylinders": 4
  },
  "performance": {
    "top_speed_kmph": 180,
    "acceleration_0_100_sec": 11.0,
    "mileage_kmpl_arai": 17.01,
    "mileage_kmpl_city": 13.5,
    "mileage_kmpl_highway": 19.5
  },
  "dimensions": {
    "length_mm": 3994,
    "width_mm": 1811,
    "height_mm": 1606,
    "wheelbase_mm": 2498,
    "ground_clearance_mm": 209,
    "boot_space_litres": 382,
    "fuel_tank_litres": 44,
    "kerb_weight_kg": 1195
  },
  "safety": {
    "ncap_rating_bharat": 5.0,
    "ncap_rating_global": null,
    "ncap_year": 2023,
    "airbags_count": 6
  },
  "features": {
    "safety": [
      {"name": "ABS", "availability": "standard"},
      {"name": "ESP", "availability": "standard"},
      {"name": "360 Camera", "availability": "not_available"}
    ],
    "comfort": [
      {"name": "Sunroof", "availability": "optional"},
      {"name": "Wireless Charging", "availability": "standard"}
    ],
    "technology": [
      {"name": "10.25\" Touchscreen", "availability": "standard"},
      {"name": "Connected Car", "availability": "standard"}
    ]
  },
  "ownership_cost": {
    "annual_fuel_cost_city": 8500000,
    "annual_insurance_yr1": 5200000,
    "annual_maintenance": 1500000,
    "tco_5yr": 125000000,
    "resale_value_5yr": 62500000
  }
}
```

---

## 5. Search

### `GET /search` 🔓
Full-text + filtered search via OpenSearch.

**Query params:** `q` (text), plus all filters from `GET /cars`

```json
// Response 200
{
  "query": "best suv under 15 lakh",
  "data": [
    {
      "id": "uuid",
      "name": "Tata Nexon",
      "slug": "tata-nexon",
      "starting_price": 800000,
      "body_type": "suv",
      "highlight": "Best-in-class <em>safety</em> with 5-star NCAP",
      "relevance_score": 0.95
    }
  ],
  "total": 12,
  "suggestions": ["Hyundai Venue", "Kia Sonet", "Maruti Brezza"]
}
```

### `GET /search/suggestions` 🔓
Autocomplete suggestions.

```json
// ?q=nexon
// Response 200
{
  "suggestions": [
    {"type": "car", "name": "Tata Nexon", "slug": "tata-nexon", "image": "..."},
    {"type": "car", "name": "Tata Nexon EV", "slug": "tata-nexon-ev", "image": "..."},
    {"type": "brand", "name": "Tata Motors", "slug": "tata-motors"}
  ]
}
```

---

## 6. Comparison

### `POST /compare` 🔓
```json
// Request
{
  "variant_ids": ["uuid1", "uuid2", "uuid3"]  // 2-5 IDs
}

// Response 200
{
  "variants": [
    {
      "id": "uuid1",
      "name": "Tata Nexon Creative+ Petrol",
      "car_name": "Tata Nexon",
      "price": 1250000,
      "specs": { /* full spec object */ },
      "features": { /* full feature object */ }
    }
  ],
  "winners": {
    "price": "uuid1",
    "mileage": "uuid3",
    "power": "uuid2",
    "safety": "uuid1",
    "boot_space": "uuid2",
    "ground_clearance": "uuid1"
  },
  "share_token": "abc123xyz"
}
```

### `GET /compare/{share_token}` 🔓
Retrieve a saved comparison by share token.

---

## 7. Ownership Cost

### `GET /ownership-cost/{variant_id}` 🔓
Default TCO with standard assumptions.

### `POST /ownership-cost/calculate` 🔓
Custom TCO calculation.

```json
// Request
{
  "variant_id": "uuid",
  "km_per_year": 20000,
  "city": "mumbai",
  "loan_amount": 1000000,
  "loan_tenure_months": 60,
  "loan_interest_rate": 8.5,
  "down_payment": 250000
}

// Response 200
{
  "variant_id": "uuid",
  "assumptions": {
    "km_per_year": 20000,
    "fuel_price_per_litre": 10400,
    "city": "mumbai"
  },
  "annual": {
    "fuel_cost": 12000000,
    "insurance_yr1": 5500000,
    "insurance_avg": 3800000,
    "maintenance": 1500000,
    "emi": 2027500
  },
  "five_year_total": {
    "fuel": 60000000,
    "insurance": 19000000,
    "maintenance": 7500000,
    "emi_total": 121650000,
    "depreciation": 45000000,
    "total_cost_of_ownership": 253150000,
    "resale_value": 68000000
  },
  "monthly_cost_breakdown": {
    "emi": 20275,
    "fuel": 10000,
    "insurance": 3167,
    "maintenance": 1250,
    "total": 34692
  }
}
```

---

## 8. AI Recommendation

### `POST /recommend` 🔓
Rule-engine recommendation (fast, < 200ms).

```json
// Request
{
  "budget_max": 1500000,
  "city": "bangalore",
  "fuel_preference": ["petrol", "mild_hybrid"],
  "body_type_preference": ["suv"],
  "seating_min": 5,
  "usage_type": "city",
  "safety_priority": 5,
  "family_size": 4,
  "session_id": "uuid"
}

// Response 200
{
  "session_id": "uuid",
  "recommendations": [
    {
      "car": {"id": "uuid", "name": "Tata Nexon", "slug": "tata-nexon", "image": "..."},
      "recommended_variant": {"id": "uuid", "name": "Creative+ Petrol AMT", "price": 1350000},
      "match_score": 94,
      "reasons": [
        "✓ Within budget (₹13.5L on-road)",
        "✓ 5-star Bharat NCAP safety",
        "✓ Best-in-class ground clearance for Bangalore roads",
        "✓ Sunroof available"
      ]
    }
  ],
  "engine_used": "rule_engine",
  "total_candidates_evaluated": 48,
  "latency_ms": 87
}
```

### `POST /recommend/ai-chat` 🔓
LLM-backed conversational advisor (streaming SSE).

```json
// Request
{
  "message": "I want a safe family SUV under 18 lakhs, mainly highway driving",
  "session_id": "uuid",
  "conversation_history": []
}

// Response: text/event-stream
data: {"type": "thinking", "content": "Analyzing your requirements..."}
data: {"type": "token", "content": "Based"}
data: {"type": "token", "content": " on"}
data: {"type": "token", "content": " your requirements..."}
data: {"type": "recommendations", "cars": [...]}
data: {"type": "done"}
```

---

## 9. Leads

### `POST /leads/dealer-enquiry` 🔓
```json
// Request
{
  "car_id": "uuid",
  "variant_id": "uuid",
  "buyer_name": "Rahul Sharma",
  "buyer_email": "rahul@example.com",
  "buyer_phone": "9876543210",
  "buyer_city": "Pune",
  "budget_max": 1500000,
  "preferred_colour": "Red",
  "session_id": "uuid",
  "utm_source": "google",
  "utm_campaign": "suv-campaign"
}

// Response 201
{
  "lead_id": "uuid",
  "message": "Your enquiry has been sent to the nearest Tata Motors dealer in Pune. They will contact you within 24 hours.",
  "dealer": {
    "name": "Concorde Motors - Pune",
    "phone": "020-XXXXXXXX"
  }
}
```

### `POST /leads/test-drive` 🔓
```json
// Request
{
  "car_id": "uuid",
  "variant_id": "uuid",
  "buyer_name": "Priya Mehta",
  "buyer_email": "priya@example.com",
  "buyer_phone": "9876543211",
  "buyer_city": "Bangalore",
  "preferred_date": "2026-07-05",
  "preferred_time_slot": "10:00-12:00"
}

// Response 201
{
  "booking_id": "uuid",
  "message": "Test drive booked! You'll receive a confirmation SMS.",
  "confirmed_date": "2026-07-05",
  "dealer": {"name": "...", "address": "..."}
}
```

### `POST /leads/loan-enquiry` 🔓
### `POST /leads/insurance-enquiry` 🔓

---

## 10. Authentication

### `POST /auth/register` 🔓
```json
// Request
{"email": "user@example.com", "password": "SecurePass123!", "full_name": "Rahul Sharma"}
// Response 201
{"user_id": "uuid", "message": "Registration successful. Please verify your email."}
```

### `POST /auth/login` 🔓
```json
// Request
{"email": "user@example.com", "password": "SecurePass123!"}
// Response 200
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer",
  "expires_in": 900,
  "user": {"id": "uuid", "email": "...", "role": "user"}
}
```

### `POST /auth/refresh` 🔓
```json
// Request
{"refresh_token": "eyJ..."}
// Response 200
{"access_token": "eyJ...", "expires_in": 900}
```

### `POST /auth/logout` 🔐
Revokes refresh token.

### `GET /auth/google` 🔓
Redirects to Google OAuth flow.

---

## 11. User Profile

### `GET /users/me` 🔐
### `PATCH /users/me` 🔐
### `GET /users/me/wishlists` 🔐
### `POST /users/me/wishlists` 🔐
### `DELETE /users/me/wishlists/{car_id}` 🔐
### `GET /users/me/leads` 🔐
### `DELETE /users/me` 🔐 — Account deletion (DPDP compliance)

---

## 12. Admin Endpoints

All require `👮` admin role.

### `POST /admin/cars` — Create car
### `PUT /admin/cars/{id}` — Update car
### `DELETE /admin/cars/{id}` — Soft delete car
### `POST /admin/variants` — Create variant
### `PUT /admin/variants/{id}` — Update variant
### `GET /admin/leads` — List all leads with filters
### `PATCH /admin/leads/{id}` — Update lead status
### `GET /admin/users` — List users
### `GET /admin/analytics/summary` — Platform KPI dashboard
### `GET /admin/analytics/cars/popular` — Top cars by views
### `GET /admin/analytics/leads/funnel` — Lead conversion funnel

---

## 13. Error Codes

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Request body/params failed Pydantic validation |
| 401 | `UNAUTHORIZED` | No or invalid JWT |
| 403 | `FORBIDDEN` | Valid JWT but insufficient role |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `CONFLICT` | Duplicate (e.g., email already registered) |
| 422 | `UNPROCESSABLE` | Semantically invalid (e.g., variant_ids in compare not from same category) |
| 429 | `RATE_LIMITED` | Too many requests |
| 503 | `SERVICE_UNAVAILABLE` | Downstream dependency (DB, AI) down |

---

*Part of Phase 2 LLD. See: [SequenceDiagrams.md](SequenceDiagrams.md)*


</details>
