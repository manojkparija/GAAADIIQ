# GAADIIQ.COM — High Level Design (HLD)

**Version:** 1.0  
**Date:** 2026-06-24  
**Status:** Approved for Phase 1

---

## 1. Solution Overview

GAADIIQ.COM is a cloud-native, AI-first automotive intelligence platform built on a **headless microservices architecture**. The system separates the frontend (Next.js on Vercel CDN edge) from the backend (FastAPI on Oracle Cloud), with a dedicated AI inference layer (Ollama + LangChain) and a data layer (PostgreSQL + Redis + OpenSearch).

The architecture is designed to:
- Run at near-zero cost on free-tier infrastructure
- Scale horizontally on Oracle Cloud's always-free ARM instances
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
- **Web Browser / Mobile Browser** — Next.js SSR/SSG pages served from Vercel edge
- **Cloudflare CDN** — Static assets, image optimisation, DDoS protection, caching

### Layer 2 — Frontend (Vercel)
- Next.js 14 App Router
- TypeScript + Tailwind CSS + ShadCN UI
- NextAuth.js for authentication
- React Query for server state management
- Deployed to Vercel (global edge network, free tier)

### Layer 3 — API Gateway / Backend (Oracle Cloud)
- FastAPI (Python 3.12) running in Docker container
- Single API server on Oracle Cloud ARM instance (4 OCPUs, 24GB RAM — always free)
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

### Layer 5 — AI Layer (Oracle Cloud — same instance)
- **Ollama** — Local LLM inference server
- **Llama 3 8B** — Primary conversational model (Smart Advisor)
- **DeepSeek R1 7B** — SEO content generation, review summaries
- **LangChain** — Prompt orchestration, RAG pipeline, conversation memory
- **ChromaDB** — Vector store for car catalog embeddings (RAG)
- **scikit-learn** — ML recommendation model (content-based filtering)

### Layer 6 — Data Layer
- **PostgreSQL 16** (Supabase free tier) — Primary relational store
- **Redis 7** (Oracle Cloud) — API response cache, session store, rate limiting
- **OpenSearch** (Oracle Cloud) — Full-text search, filtered car queries
- **Cloudflare R2** — Car images, static media (10GB free, zero egress cost)

### Layer 7 — Observability
- **Prometheus** — Metrics scraping (FastAPI, Nginx, system)
- **Grafana** — Dashboards, alerts
- **Loki** — Log aggregation
- All running on Oracle Cloud (same instance, different Docker containers)

---

## 4. Data Flow Summary

### 4.1 Car Catalog Page (SSG/ISR)
```
Browser → Cloudflare CDN → Vercel Edge → Next.js ISR Cache
  → (cache miss) → FastAPI /api/cars/{slug}
  → Redis cache check → (cache miss) → PostgreSQL
  → Response cached in Redis (TTL 1hr) → returned to browser
```

### 4.2 AI Advisor (Real-time)
```
Browser (wizard answers) → Next.js API Route → FastAPI /api/recommend
  → RecommendationService (rule engine, < 100ms)
  → [if LLM requested] AIAdvisorService → LangChain → Ollama (Llama 3)
  → ChromaDB (car embeddings) → RAG-augmented response
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
| Vercel | Next.js hosting + CDN | Free |
| Oracle Cloud | VM for backend, Redis, OpenSearch, AI | Always free |
| Cloudflare | CDN, R2 object storage, DNS, DDoS | Free |
| GitHub Actions | CI/CD pipelines | Free (2,000 min/month) |
| SMTP (Brevo/Resend) | Transactional email | Free (300/day) |
| Google OAuth | Social login | Free |
| Google Analytics 4 | User analytics | Free |
| Google Search Console | SEO indexing | Free |

---

## 6. Scalability Architecture

### Current Capacity (Free Tier)
- Oracle Cloud: 4 OCPUs, 24GB RAM → supports ~500 concurrent users
- Supabase: 500MB PostgreSQL → supports ~1M car records
- Vercel: 100GB bandwidth/month → supports ~2M page views

### Scale-Out Path (When Revenue Justifies)
1. **Database:** Supabase Pro (₹1,750/month) → 8GB, connection pooling
2. **Backend:** Add second Oracle Cloud account (another always-free instance) → 2× capacity
3. **AI:** GPU VM for faster LLM inference (₹5,000/month Oracle spot) → 10× speed
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

### ADR-01: Monolith vs Microservices
**Decision:** Start as modular monolith (FastAPI), extract services when justified.  
**Reason:** Microservices at MVP with one engineer (AI) adds 3× operational complexity for no benefit. The modular structure allows future extraction.

### ADR-02: Supabase vs Self-hosted PostgreSQL
**Decision:** Supabase for MVP, migrate to Oracle Cloud PostgreSQL if free tier exceeded.  
**Reason:** Supabase provides managed backups, connection pooling, and a REST API for free. Migration is one `pg_dump` + restore.

### ADR-03: Ollama (self-hosted) vs OpenAI API
**Decision:** Ollama with Llama 3 on Oracle Cloud.  
**Reason:** OpenAI API costs ~₹0.60–₹6 per 1,000 requests. At 1M AI requests/month = ₹6,00,000/month. Ollama is free on Oracle's always-free ARM instance.

### ADR-04: Next.js App Router vs Pages Router
**Decision:** App Router (Next.js 14+).  
**Reason:** Server Components reduce client JS bundle. Streaming SSR for faster TTFB. ISR built-in for car catalog pages.

---

*See also: [ArchitectureDiagram.md](ArchitectureDiagram.md) | [DeploymentDiagram.md](DeploymentDiagram.md) | [SecurityArchitecture.md](SecurityArchitecture.md) | [MonitoringArchitecture.md](MonitoringArchitecture.md)*
