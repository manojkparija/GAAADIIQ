# GAADIIQ.COM — Sequence Diagrams

**Version:** 1.0  
**Date:** 2026-06-24

---

## 1. User Registration & Email Verification

```mermaid
sequenceDiagram
    actor U as User
    participant FE as Next.js
    participant API as FastAPI
    participant DB as PostgreSQL
    participant SMTP as Brevo SMTP

    U->>FE: Fill registration form
    FE->>FE: Client-side validation
    FE->>API: POST /auth/register {email, password, name}
    API->>API: Validate with Pydantic
    API->>DB: SELECT * FROM users WHERE email=?
    DB-->>API: empty (no conflict)
    API->>API: bcrypt.hash(password, cost=12)
    API->>DB: INSERT INTO users (email, password_hash, ...)
    DB-->>API: user record
    API->>API: Generate verification token (JWT, 24h TTL)
    API->>SMTP: Send verification email
    SMTP-->>U: Email: "Verify your GAADIIQ account"
    API-->>FE: 201 {"message": "Please verify your email"}
    FE-->>U: "Check your inbox!"

    U->>FE: Click verification link /verify?token=...
    FE->>API: POST /auth/verify-email {token}
    API->>API: Verify JWT token, extract user_id
    API->>DB: UPDATE users SET email_verified=TRUE WHERE id=?
    API-->>FE: 200 {access_token, refresh_token}
    FE->>FE: Store session (NextAuth)
    FE-->>U: Redirect to dashboard
```

---

## 2. Car Search Flow

```mermaid
sequenceDiagram
    actor U as User
    participant FE as Next.js
    participant API as FastAPI
    participant REDIS as Redis
    participant OS as OpenSearch
    participant DB as PostgreSQL

    U->>FE: Types in search box "suv under 15 lakh"
    FE->>FE: Debounce 300ms
    FE->>API: GET /search/suggestions?q=suv+under+15
    API->>REDIS: GET cache:suggestions:suv+under+15
    REDIS-->>API: null (miss)
    API->>OS: suggest_query("suv under 15")
    OS-->>API: [Tata Nexon, Hyundai Venue, Kia Sonet, ...]
    API->>REDIS: SET cache:suggestions:... TTL 300s
    API-->>FE: {suggestions: [...]}
    FE-->>U: Dropdown suggestions appear

    U->>FE: Submit search / select suggestion
    FE->>API: GET /search?q=suv&body_type=suv&price_max=1500000&sort=popularity
    API->>REDIS: GET cache:search:{hash_of_params}
    REDIS-->>API: null (miss)
    API->>OS: full_search_query(q, filters, sort)
    OS-->>API: [{car_id, score, highlight}, ...]
    API->>DB: SELECT cars + variants WHERE id IN (result_ids)
    DB-->>API: enriched car records
    API->>API: Merge OS scores with DB data
    API->>REDIS: SET cache:search:{hash} TTL 300s
    API-->>FE: {data: [...], total: 18}
    FE-->>U: Render search results page
```

---

## 3. Car Comparison Flow

```mermaid
sequenceDiagram
    actor U as User
    participant FE as Next.js
    participant API as FastAPI
    participant REDIS as Redis
    participant DB as PostgreSQL

    U->>FE: Click "Add to Compare" on Tata Nexon
    FE->>FE: Add to compareList[] in localStorage
    FE-->>U: Compare bar appears at bottom (1/5 added)

    U->>FE: Add Hyundai Creta, Kia Seltos
    FE-->>U: Compare bar shows 3 cars

    U->>FE: Click "Compare Now"
    FE->>API: POST /compare {variant_ids: [id1, id2, id3]}
    API->>REDIS: GET cache:compare:{sorted_ids_hash}
    REDIS-->>API: null (miss)
    API->>DB: SELECT variants + features + ownership_cost WHERE id IN (...)
    DB-->>API: 3 full variant records
    API->>API: Compute winners per category
    API->>API: Generate share_token = base62(uuid)
    API->>REDIS: SET cache:compare:{hash} TTL 3600s
    API->>DB: INSERT INTO comparison_cache (share_token, data, expires_at)
    API-->>FE: {variants: [...], winners: {...}, share_token: "abc123"}
    FE-->>U: Render comparison table with winner highlights

    U->>FE: Click "Share Comparison"
    FE-->>U: Copy URL: gaadiiq.com/compare/abc123
```

---

## 4. AI Recommendation Wizard

```mermaid
sequenceDiagram
    actor U as User
    participant FE as Next.js
    participant API as FastAPI
    participant RULE as Rule Engine
    participant DB as PostgreSQL
    participant LC as LangChain
    participant OL as Ollama

    U->>FE: Click "Find My Perfect Car"
    FE-->>U: Step 1: "What's your budget?" slider
    U->>FE: ₹8L – ₹15L
    FE-->>U: Step 2: "How many seats?" 
    U->>FE: 5 seats
    FE-->>U: Step 3: "Fuel preference?"
    U->>FE: Petrol or Hybrid
    FE-->>U: Step 4: "Body type?"
    U->>FE: SUV
    FE-->>U: Step 5: "Primary use?"
    U->>FE: City driving
    FE-->>U: Step 6: "Safety priority? (1-5)"
    U->>FE: 5 (very important)

    FE->>API: POST /recommend {budget_max:1500000, seating:5, fuel:[petrol,hybrid], body:[suv], usage:city, safety:5}
    API->>RULE: evaluate(inputs)
    RULE->>DB: SELECT cars+variants WHERE price<=1500000 AND fuel IN ('petrol','mild_hybrid') AND body_type='suv' AND seating>=5 ORDER BY ncap_rating DESC, mileage DESC
    DB-->>RULE: 23 matching variants
    RULE->>RULE: Score each: price_score + safety_score + mileage_score + popularity_score
    RULE-->>API: top 3 scored cars, latency 65ms

    API-->>FE: {recommendations: [Nexon, Venue, Brezza], engine:"rule_engine", latency_ms:65}
    FE-->>U: Show Top 3 Picks with match scores

    U->>FE: Click "Ask AI Why?" on Tata Nexon
    FE->>API: POST /recommend/ai-chat {message:"Why Nexon for me?", session_id, context:{inputs}}
    API->>LC: explain_recommendation(car=Nexon, user_inputs=...)
    LC->>LC: Build prompt with car specs + user inputs
    LC->>OL: POST /api/generate {model:"llama3:8b", prompt:..., stream:true}
    OL-->>LC: Stream tokens
    LC-->>API: Stream tokens via SSE
    API-->>FE: SSE stream
    FE-->>U: AI explanation appears word-by-word
```

---

## 5. Dealer Lead Submission

```mermaid
sequenceDiagram
    actor U as User
    participant FE as Next.js
    participant API as FastAPI
    participant DB as PostgreSQL
    participant SMTP as Brevo SMTP
    participant DEALER as Dealer Dashboard

    U->>FE: Click "Get Best Price" on Tata Nexon variant page
    FE-->>U: Modal: Name, Phone, Email, City (pre-filled if logged in)
    U->>FE: Fill + submit form
    FE->>FE: Validate (name, phone format, email)
    FE->>API: POST /leads/dealer-enquiry {car_id, variant_id, buyer_info, city}
    
    API->>API: Validate with Pydantic
    API->>API: Compute intent_score (page source, session depth, device, time on page)
    API->>DB: SELECT dealers WHERE brand_id=tata AND city=pune AND is_active=TRUE ORDER BY priority
    DB-->>API: nearest dealer record
    API->>DB: INSERT INTO leads (type=dealer_enquiry, status=new, intent_score=82, dealer_id=...)
    DB-->>API: lead record with id
    
    API->>SMTP: Send email to dealer (lead notification)
    SMTP-->>DEALER: "New lead: Rahul Sharma wants Nexon — Intent Score: 82/100"
    
    API->>SMTP: Send confirmation to buyer
    SMTP-->>U: "Your enquiry has been sent to Concorde Motors, Pune"
    
    API-->>FE: 201 {lead_id, dealer: {name, phone}, message}
    FE-->>U: Success modal with dealer contact info
```

---

## 6. Admin: Add New Car

```mermaid
sequenceDiagram
    actor A as Admin
    participant FE as Admin Portal
    participant API as FastAPI
    participant DB as PostgreSQL
    participant OS as OpenSearch
    participant R2 as Cloudflare R2

    A->>FE: Navigate to /admin/cars/new
    FE->>API: GET /brands (populate dropdown)
    A->>FE: Fill car form (name, brand, body type, etc.)
    A->>FE: Upload hero image
    FE->>API: POST /admin/upload-image {file, category:exterior, angle:front}
    API->>R2: PUT car-images/{uuid}.webp
    R2-->>API: {url: "https://cdn.gaadiiq.com/..."}
    API-->>FE: {image_url: "..."}

    A->>FE: Submit car form
    FE->>API: POST /admin/cars {brand_id, name, slug, body_type, ...}
    API->>API: Validate (Pydantic, slug uniqueness)
    API->>DB: INSERT INTO cars (...)
    DB-->>API: car record
    API->>OS: index_document(index=cars, doc={car data})
    OS-->>API: indexed
    API-->>FE: 201 {car_id, slug}
    FE-->>A: "Car created. Add variants →"
```

---

## 7. TCO Calculator Interaction

```mermaid
sequenceDiagram
    actor U as User
    participant FE as Next.js
    participant API as FastAPI
    participant REDIS as Redis
    participant DB as PostgreSQL

    U->>FE: Open variant page — TCO section visible
    FE->>API: GET /ownership-cost/{variant_id}
    API->>REDIS: GET cache:tco:{variant_id}:defaults
    REDIS-->>API: {tco_data} (cache HIT — 1hr TTL)
    API-->>FE: Default TCO data
    FE-->>U: TCO chart with default 15,000 km/year assumption

    U->>FE: Adjust slider: 25,000 km/year
    U->>FE: Change city: Mumbai
    U->>FE: Add loan: ₹10L, 5 years, 8.5%
    FE->>FE: Debounce 500ms
    FE->>API: POST /ownership-cost/calculate {variant_id, km_per_year:25000, city:mumbai, loan_amount:1000000, ...}
    API->>DB: SELECT variants WHERE id=? (get mileage, price)
    API->>API: Fetch Mumbai fuel price (from config/seed data)
    API->>API: Calculate: fuel_cost = 25000 / mileage × fuel_price × 5
    API->>API: Calculate: insurance, maintenance, EMI, depreciation
    API-->>FE: Custom TCO breakdown
    FE-->>U: Updated charts animate to new values
```

---

*Part of Phase 2 LLD. See: [UIArchitecture.md](UIArchitecture.md) | [AIArchitecture.md](AIArchitecture.md)*
