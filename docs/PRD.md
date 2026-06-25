# GAADIIQ.COM — Product Requirements Document (PRD)

**Version:** 1.0  
**Date:** 2026-06-24  
**Status:** Approved for Phase 0

---

## 1. User Personas

### Persona 1: Rahul — First-Time Buyer
- **Age:** 28 | **City:** Pune | **Income:** ₹8L/year
- **Goal:** Buy first car under ₹10L; needs guidance on which segment to consider.
- **Pain:** Overwhelmed by options; doesn't know difference between variants.
- **How GAADIIQ helps:** AI Advisor walks him through budget, commute, and family size → recommends Swift vs Tata Punch vs WagonR with TCO breakdown.

### Persona 2: Priya — Upgrading Buyer
- **Age:** 35 | **City:** Bengaluru | **Income:** ₹18L/year
- **Goal:** Upgrade from hatchback to SUV; interested in petrol or mild hybrid.
- **Pain:** Can't make sense of EMI vs fuel cost tradeoff; dealer pressure.
- **How GAADIIQ helps:** Comparison tool shows Creta vs Seltos vs Nexon with 5-year cost model; shows EMI calculator with bank quotes.

### Persona 3: Vikram — EV Researcher
- **Age:** 40 | **City:** Delhi | **Income:** ₹25L/year
- **Goal:** Evaluate switching from ICE to EV; concerned about range and charging.
- **Pain:** No single platform shows charging infrastructure, real-world range, and TCO for Indian conditions.
- **How GAADIIQ helps:** EV intelligence layer shows charging points near home/office, range on Indian driving cycle, 5-year cost vs petrol equivalent.

### Persona 4: Ramesh — Dealer Owner
- **Age:** 45 | **City:** Hyderabad
- **Goal:** Get quality buyer leads; reduce cost per acquisition.
- **Pain:** Existing platforms send low-intent leads; paying ₹2,000 per junk lead.
- **How GAADIIQ helps:** Intent-scored leads with buyer profile, preferred car, and budget pre-filled; dashboard to track conversion.

---

## 2. Feature List

### 2.1 MVP Features (Phases 4–10)

#### Car Catalog
- [ ] List all brands with logo, origin country, tagline
- [ ] List all models per brand with hero image, starting price, body type
- [ ] Variant pages: full specs, features, colour options, price breakdown
- [ ] Expert review per model (AI-generated initial, manually refined)
- [ ] User ratings (star) and comments

#### Search & Filter
- [ ] Text search (brand, model name, feature keywords)
- [ ] Filter: Budget (slider), Body Type, Fuel, Transmission, Seating, Safety Rating
- [ ] Sort: Price (asc/desc), Popularity, Rating, Mileage
- [ ] Recently viewed, shortlisted cars (saved to user profile)

#### Car Comparison
- [ ] Select 2–5 cars to compare
- [ ] Side-by-side specs table (100+ parameters)
- [ ] Category winner highlight (e.g., "Best Mileage: Maruti Dzire")
- [ ] Share comparison as URL

#### Ownership Cost Calculator
- [ ] Fuel cost: km/year × city fuel price ÷ ARAI mileage
- [ ] Insurance: first-year OD + TP premium estimate
- [ ] Maintenance: service schedule cost per year
- [ ] Depreciation: IDV curve over 5 years
- [ ] EMI: on-road price, LTV, tenure, interest rate
- [ ] TCO summary card: ₹X over 5 years

#### AI Recommendation Engine
- [ ] 6-question onboarding wizard (budget, city, usage, family, fuel, priority)
- [ ] Top 3 car recommendations with match score
- [ ] Explanation card ("Recommended because: budget match ✓, 5-seater ✓, best mileage in class ✓")
- [ ] "Ask GAADIIQ" chat interface (LLM-backed)

#### Dealer Lead Module
- [ ] "Get Best Price" form → dealer lead
- [ ] "Book Test Drive" form → scheduled appointment
- [ ] Loan enquiry → routed to partner NBFC
- [ ] Insurance enquiry → routed to partner insurer
- [ ] User receives confirmation via email

#### User Account
- [ ] Register / Login (email + Google OAuth)
- [ ] Shortlist / Wishlist
- [ ] Comparison history
- [ ] Lead status tracking
- [ ] EMI saved calculations

### 2.2 Post-MVP Features (Phase 11+)

- Premium subscription (₹299/month): advanced analytics, price drop alerts, personalised report
- Used car valuation tool
- EV charging infrastructure overlay map
- Real-time price tracking and waitlist intelligence
- Dealer reviews and ratings
- Community forum

---

## 3. Page Structure (Sitemap)

```
/ (Home)
├── /cars                          — Browse all cars
│   ├── /cars/[brand]              — Brand page
│   └── /cars/[brand]/[model]      — Model page
│       └── /cars/[brand]/[model]/[variant]  — Variant detail
├── /compare                       — Comparison tool
├── /search                        — Search results
├── /recommend                     — AI Advisor wizard
├── /ownership-cost                — TCO calculator
├── /dealers                       — Dealer directory
├── /news                          — Auto news (AI-curated)
├── /login                         — Auth
├── /profile                       — User profile
└── /admin                         — Admin portal (protected)
```

---

## 4. AI Features Detail

### 4.1 Smart Advisor (Conversational)
- Model: Llama 3 8B via Ollama (self-hosted, free)
- Prompt context: full car catalog + user session
- Output: ranked car list with reasoning
- Fallback: rule-based engine if LLM unavailable

### 4.2 ML Recommendation Engine
- Algorithm: Content-based filtering (Phase 1) → Collaborative filtering (Phase 2 after user data)
- Features: budget range, body type, fuel, seating, safety rating, mileage, brand preference
- Training: synthetic Indian buyer dataset (seeded) → real user interaction data
- Framework: scikit-learn → MLflow for experiment tracking

### 4.3 Auto-generated SEO Content
- Model: DeepSeek R1 (free, open-source)
- Output: meta description, page summary, FAQ schema per car page
- Tone: informative, Indian context, avoid superlatives

---

## 5. Technical Requirements

| Component | Technology | Tier |
|---|---|---|
| Frontend | Next.js 14 + TypeScript + Tailwind + ShadCN | Free (Vercel) |
| Backend API | FastAPI + Python 3.12 | Free (Oracle Cloud) |
| Database | PostgreSQL 16 | Free (Supabase) |
| Cache | Redis 7 | Free (Oracle Cloud) |
| Search | OpenSearch | Free (Oracle Cloud) |
| AI Inference | Ollama + Llama 3 + DeepSeek | Free (self-hosted) |
| Auth | JWT + NextAuth | Free |
| Object Storage | Cloudflare R2 (10GB free) | Free |
| CDN | Cloudflare Free | Free |
| Monitoring | Prometheus + Grafana + Loki | Free (self-hosted) |
| CI/CD | GitHub Actions | Free (2,000 min/month) |

**Estimated monthly cost:** ₹0 (MVP) → ₹2,000–₹5,000 at scale.

---

## 6. MVP Scope Boundary

**IN scope for MVP:**
- Car catalog (300 variants minimum)
- Search + filter
- Compare (up to 5 cars)
- Ownership cost calculator
- AI recommendation wizard
- Dealer lead / test drive booking
- User accounts (basic)
- Admin portal (basic)

**OUT of scope for MVP:**
- Used car section
- Community/forum
- Native mobile app
- Real-time price scraping
- EV charging map
- Premium subscription billing

---

*Previous: [BRD.md](BRD.md) | Next: [CompetitorAnalysis.md](CompetitorAnalysis.md)*
