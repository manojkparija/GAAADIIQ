# GAADIIQ.COM — High Level Design (HLD)

**Version:** 2.0
**Date:** 2026-08-14
**Status:** Corrected against the code. See the drift note below.  
**Status:** Approved for Phase 1

---

> **Read `HLD/SystemOverview.md` first.** It is the as-built description of the
> whole system, written from the code, and it carries the findings this document
> is too narrow to hold — four schema sources, a second AI path that bypasses
> the API, and 74 of 91 settings unset in production.
>
> **Corrected 2026-08-14.** v1.0 described the backend, Redis, OpenSearch,
> Ollama and the whole observability stack as running on an Oracle Cloud ARM VM,
> and the frontend as Next.js. Neither is true: the web app is Angular 17 on
> Vercel and the API is a Docker service on Render. Sections 1, 3, 4, 5, 6 and 7
> have been rewritten. `HLD/ArchitectureDiagram.md` and
> `HLD/DeploymentDiagram.md` carry the detail, including a table of services
> that are configured in code but have no endpoint set in production.

## 1. Solution Overview

GAADIIQ.COM is an Indian car marketplace built as a **client-rendered Angular
application against a single FastAPI service**. The web app (Angular 17,
standalone components, signals) is a static bundle on Vercel; the API is one
FastAPI service on Render, deployed from `master` as a Docker image; all
persistent state is PostgreSQL on Supabase. It is a modular monolith, not
microservices — there is one deployable API.

The AI layer is a ladder rather than a service: a curated knowledge base answers
first, and Gemini is reached only when nothing curated matches.

The architecture is designed to:
- Run at near-zero cost on free-tier infrastructure
- Scale by Render instance size and count; the API is stateless apart from the in-process cache fallback
- Serve the Indian market with sub-2.5s page loads via Cloudflare CDN
- Support 500K MAU at MVP, scaling to 5M MAU with no architectural change

---

## 2. Architecture Style

| Decision | Choice | Rationale |
|---|---|---|
| API style | REST (primary) + WebSocket (AI chat) | REST is cacheable; WS needed for streaming LLM |
| Frontend pattern | SSG + ISR + CSR hybrid | SSG for SEO pages; ISR for catalog; CSR for dynamic tools |
| Backend pattern | Domain-driven layered API | Clean separation: Router → Service → Repository → DB |
| Data pattern | CQRS (read/write separation) | Redis + OpenSearch for reads; PostgreSQL for writes |
| AI pattern | RAG (Retrieval-Augmented Generation) | Car catalog as vector knowledge base for LLM context |
| Deployment | Containerised (Docker) | Consistent dev/prod parity; easy scaling |

---

## 3. System Layers

### Layer 1 — Client
- **Web / mobile browser** — a client-rendered Angular SPA served from Vercel's edge. There is no server rendering.
- **Cloudflare CDN** — Static assets, image optimisation, DDoS protection, caching

### Layer 2 — Web app (Vercel)
- Angular 17, standalone components, signals, 44 lazy routes
- No store library: state lives in services as signals
- `auth.interceptor` attaches the Supabase token to every call at `environment.apiUrl`
- TypeScript + SCSS with CSS custom-property theme tokens (`--primary`, `--teal`, the `--*-ink` text tokens)
- NextAuth.js for authentication
- React Query for server state management
- Deployed to Vercel (global edge network, free tier)

### Layer 3 — API (Render)
- FastAPI (Python 3.12) running in Docker container
- Single FastAPI service on Render (Docker). 29 routers, 164 endpoints.
- `alembic upgrade head` runs on every deploy
- Nginx reverse proxy (SSL termination, rate limiting)
- JWT authentication middleware
- CORS configured for gaadiiq.com origin only

### Layer 4 — Business Services
All within the FastAPI monolith at MVP (modular, ready to extract to microservices):

| Service | Responsibility |
|---|---|
| CatalogService | Car, brand, variant, spec CRUD |
| SearchService | OpenSearch query builder |
| ComparisonService | Side-by-side diff engine |
| OwnershipCostService | TCO calculation engine |
| RecommendationService | Rule engine + ML model inference |
| AIAdvisorService | LLM chat orchestration (LangChain) |
| LeadService | Dealer lead capture and routing |
| UserService | Auth, profiles, wishlists |
| AdminService | CMS operations |
| AnalyticsService | Event ingestion, aggregation |

### Layer 5 — AI layer

**Google Gemini is the only LLM that answers a real request today.** v1.0 of
this document did not mention it at all, because the design predated it.

- **Google Gemini** (`gemini-3.5-flash-lite`, overridable via `GEMINI_MODEL`) —
  the production model. Serves premium-tier diagnosis, brochure ingestion,
  variant research and resale forecasting. `GEMINI_API_KEY` is set in
  `render.yaml`, so this is the one inference path that actually works in
  production.
- **`services/gemini_gateway.py`** — the single door. Every Gemini call goes
  through `generate_text`; five call sites across four services used to build
  their own request and put the API key in the URL, where it reached logs,
  tracebacks and every proxy in between. The gateway sends it as an
  `x-goog-api-key` header, and is also the only place a timeout, a model choice
  and a 429 retry (three attempts, backing off) can be enforced. An
  `httpx.post` against `generativelanguage.googleapis.com` anywhere else is the
  bug this module exists to prevent.
- **`services/llm_tier.py`** — decides *whether* Gemini is used. Free vs premium
  is resolved from the caller's Supabase JWT, verified against the JWKS, and
  never from the request body: reading it from the body would let a free user
  send a paid user's UUID and be upgraded.
- **Knowledge base first.** For diagnosis, Gemini is the last resort rather than
  the first step — cache, then symptom aliases, then a scoped exact lookup, then
  semantic search, and only then the model. A curated, human-verified answer
  costs no tokens. See `LLD/AIArchitecture.md` §0.
- **Ollama** / **Llama 3 8B** — the intended free-tier engine. Still coded as a
  fallback rung, but `OLLAMA_BASE_URL` is **unset in production** and defaults
  to `localhost:11434`, so it is unreachable on Render and free-tier requests
  fall through to the heuristic.
- **fastembed** (`BAAI/bge-small-en-v1.5`, 384-dim) + **Qdrant** — embeddings
  and listing vectors. Not ChromaDB, which was never used. `QDRANT_URL` is unset
  in production; the diagnosis KB keeps its vectors in process instead.
- **LangChain** — real, but far narrower than "prompt orchestration, RAG
  pipeline, conversation memory". It is imported in exactly one file,
  `services/sentiment.py`, and only for `Ollama`, `PromptTemplate` and
  `StrOutputParser`.
- ~~**DeepSeek R1 7B** — SEO content generation~~ — never built; no reference
  anywhere in the codebase.
- ~~**scikit-learn** — ML recommendation model~~ — the package is installed as a
  transitive dependency, but nothing under `services/` or `routers/` imports it.

### Layer 6 — Data Layer
- **PostgreSQL 16** (Supabase free tier) — Primary relational store
- **Redis** — OTP digests and the diagnosis response cache. `REDIS_URL` is **not set in production**; both fall back to a per-process dict.
- **OpenSearch** — listing full-text index. `OPENSEARCH_URL` is **not set in production**; search falls back to Postgres.
- **Cloudflare R2** — Car images, static media (10GB free, zero egress cost)

### Layer 7 — Observability
- **Prometheus** — Metrics scraping (FastAPI, Nginx, system)
- **Grafana** — Dashboards, alerts
- **Loki** — Log aggregation
- **Not deployed.** `prometheus_client` exposes `/metrics` from the API and nothing scrapes it. There is no Prometheus, Grafana, Loki or Alertmanager in this repository.

---

## 4. Data Flow Summary

### 4.1 Car Catalog Page (SSG/ISR)
```
Browser → Vercel Edge (static Angular bundle) → XHR to the API
  → (cache miss) → FastAPI /api/cars/{slug}
  → Redis cache check → (cache miss) → PostgreSQL
  → Response cached in Redis (TTL 1hr) → returned to browser
```

### 4.2 AI Advisor (Real-time)
```
Browser (wizard answers) → FastAPI /recommend
  → RecommendationService (rule engine, < 100ms)
  → [if LLM requested] AIAdvisorService → LangChain → Ollama (Llama 3)
  → knowledge base (alias → exact → semantic) → Gemini only on a full miss
  → Streamed back to browser via WebSocket / SSE
```

### 4.3 Dealer Lead Submission
```
Browser form → FastAPI /api/leads
  → Validate (Pydantic) → Write to PostgreSQL
  → Trigger email (SMTP) → dealer notification
  → Analytics event → Prometheus counter increment
  → 200 OK to browser
```

### 4.4 Search
```
Browser → FastAPI /api/search?q=...&filters=...
  → Redis cache check → (miss) → OpenSearch query
  → Results ranked by relevance + popularity score
  → Cached in Redis (TTL 5min) → returned
```

---

## 5. Integration Points

| External Service | Purpose | Cost |
|---|---|---|
| Supabase | PostgreSQL hosting | Free (500MB) |
| Vercel | Angular static hosting + CDN | Free |
| Google Gemini | LLM for premium diagnosis, brochure ingestion, variant research, resale forecast | Per-token |
| Render | FastAPI service (Docker), deployed from master | Paid tier |
| Cloudflare | CDN, R2 object storage, DNS, DDoS | Free |
| GitHub Actions | CI/CD pipelines | Free (2,000 min/month) |
| SMTP (Brevo/Resend) | Transactional email | Free (300/day) |
| Google OAuth | Social login | Free |
| Google Analytics 4 | User analytics | Free |
| Google Search Console | SEO indexing | Free |

---

## 6. Scalability Architecture

### Current Capacity (Free Tier)
- Render instance limits. The figure that used to sit here (~500 concurrent users on a 4-OCPU VM) described hardware that was never provisioned; no load test has been run against Render.
- Supabase: 500MB PostgreSQL → supports ~1M car records
- Vercel: 100GB bandwidth/month → supports ~2M page views

### Scale-Out Path (When Revenue Justifies)
1. **Database:** Supabase Pro (₹1,750/month) → 8GB, connection pooling
2. **Backend:** larger or additional Render instances. The API is stateless except for the in-process cache fallback, which is a hit-rate cost rather than a correctness one.
3. **AI:** the cheapest win is knowledge-base coverage, not faster inference — a curated hit costs no tokens at all.
4. **Search:** Scale OpenSearch heap from 2GB to 8GB on same VM

### Caching Strategy
| Layer | Tool | TTL | What's Cached |
|---|---|---|---|
| CDN | Cloudflare | 24hr | Static assets, images |
| API | Redis | 1hr | Car catalog pages, specs |
| Search | Redis | 5min | Search result sets |
| Session | Redis | 7 days | JWT refresh tokens |
| AI | Redis | 24hr | Identical recommendation requests |

---

## 7. API Design Principles

- **RESTful** with consistent URL patterns: `/api/v1/{resource}`
- **Versioned** from day 1 (`/api/v1/`) — allows non-breaking future changes
- **Pagination** on all list endpoints (cursor-based for performance)
- **Filtering** via query params: `?brand=tata&fuel=electric&price_max=2000000`
- **OpenAPI spec** auto-generated by FastAPI at `/api/docs`
- **Rate limiting** via Nginx: 100 req/min unauthenticated, 500 req/min authenticated

---

## 8. Key Architectural Decisions

*These are kept as written. An ADR records what was decided at the time, so the
correct treatment when reality diverges is an outcome note, not a rewrite.*

### ADR-01: Monolith vs Microservices
**Decision:** Start as modular monolith (FastAPI), extract services when justified.  
**Reason:** Microservices at MVP with one engineer (AI) adds 3× operational complexity for no benefit. The modular structure allows future extraction.

### ADR-02: Supabase vs Self-hosted PostgreSQL
**Decision:** Supabase for MVP, migrate to Oracle Cloud PostgreSQL if free tier exceeded.  
**Reason:** Supabase provides managed backups, connection pooling, and a REST API for free. Migration is one `pg_dump` + restore.
**Outcome (2026-08):** Held. Supabase is still the database. The migration
target named here — Oracle Cloud PostgreSQL — is not in use and not planned.

### ADR-03: Ollama (self-hosted) vs OpenAI API
**Decision:** Ollama with Llama 3 on Oracle Cloud.  
**Reason:** OpenAI API costs ~₹0.60–₹6 per 1,000 requests. At 1M AI requests/month = ₹6,00,000/month. Ollama is free on Oracle's always-free ARM instance.
**Outcome (2026-08): partly reversed, and the cost argument was answered
differently.** No Ollama host was ever provisioned — `OLLAMA_BASE_URL` is unset
in production, so the Ollama rung is unreachable and free-tier requests land on
the heuristic fallback. Gemini Flash serves the premium tier. The per-request
cost problem this ADR was trying to solve is now addressed by the knowledge
base instead: a curated, human-verified answer costs no tokens at all, and the
model is reached only when nothing curated matches. See
`LLD/AIArchitecture.md`.

### ADR-04: Next.js App Router vs Pages Router
**Decision:** App Router (Next.js 14+).
**Reason:** Server Components reduce client JS bundle. Streaming SSR for faster TTFB. ISR built-in for car catalog pages.
**Outcome: superseded — see ADR-05. Next.js was never used.**

### ADR-05: Angular 17 (as built)
**Decision:** Angular 17, standalone components and signals, built to a static
bundle and served by Vercel.
**Reason:** recorded after the fact — this document did not describe the
frontend that was built, and the rationale for the switch was never written
down. What can be stated is the consequence: there is no server rendering, so
the SEO benefit ADR-04 was reaching for was not obtained. Adding Angular SSR
for the catalogue routes is a real project, not a configuration change.

---

*See also: [ArchitectureDiagram.md](ArchitectureDiagram.md) | [DeploymentDiagram.md](DeploymentDiagram.md) | [SecurityArchitecture.md](SecurityArchitecture.md) | [MonitoringArchitecture.md](MonitoringArchitecture.md)*
