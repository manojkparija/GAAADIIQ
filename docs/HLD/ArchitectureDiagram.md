# GAADIIQ.COM — Architecture Diagrams

**Version:** 1.0  
**Date:** 2026-06-24

All diagrams use Mermaid syntax (renders in GitHub, Notion, and VS Code with Mermaid extension).

---

## 1. System Context Diagram

```mermaid
C4Context
  title System Context — GAADIIQ.COM

  Person(buyer, "Car Buyer", "Indian consumer researching vehicles")
  Person(dealer, "Dealer", "Automotive dealer receiving leads")
  Person(admin, "Admin / Founder", "Platform administrator")

  System(gaadiiq, "GAADIIQ.COM", "AI-powered automotive intelligence platform")

  System_Ext(supabase, "Supabase", "Managed PostgreSQL database")
  System_Ext(vercel, "Vercel", "Next.js hosting & CDN")
  System_Ext(oracle, "Oracle Cloud", "Backend compute, Redis, OpenSearch, Ollama")
  System_Ext(cloudflare, "Cloudflare", "CDN, R2 storage, DNS, DDoS protection")
  System_Ext(google, "Google OAuth", "Social authentication")
  System_Ext(email, "Brevo SMTP", "Transactional email")

  Rel(buyer, gaadiiq, "Searches, compares, gets AI recommendations, books test drive")
  Rel(dealer, gaadiiq, "Views leads, manages test drive appointments")
  Rel(admin, gaadiiq, "Manages cars, dealers, content, analytics")

  Rel(gaadiiq, supabase, "Reads/writes car data, users, leads")
  Rel(gaadiiq, vercel, "Frontend deployed and served")
  Rel(gaadiiq, oracle, "Backend API, AI inference, cache, search")
  Rel(gaadiiq, cloudflare, "Static assets, images, CDN routing")
  Rel(gaadiiq, google, "OAuth token exchange")
  Rel(gaadiiq, email, "Lead notifications, booking confirmations")
```

---

## 2. Component Diagram

```mermaid
C4Component
  title Component Diagram — GAADIIQ.COM

  Container_Boundary(frontend, "Frontend — Vercel") {
    Component(pages, "Next.js Pages", "App Router, SSG/ISR/CSR")
    Component(components, "UI Components", "ShadCN, Tailwind, React")
    Component(hooks, "React Hooks & Query", "Server state, caching")
    Component(auth_fe, "NextAuth", "JWT session management")
  }

  Container_Boundary(backend, "Backend — Oracle Cloud") {
    Component(api, "FastAPI Router", "REST endpoints /api/v1/*")
    Component(catalog_svc, "CatalogService", "Brand, car, variant, spec logic")
    Component(search_svc, "SearchService", "OpenSearch query builder")
    Component(compare_svc, "ComparisonService", "Spec diff engine")
    Component(tco_svc, "OwnershipCostService", "TCO calculation engine")
    Component(lead_svc, "LeadService", "Lead capture, routing")
    Component(user_svc, "UserService", "Auth, profile, wishlist")
    Component(ai_svc, "AIAdvisorService", "LangChain orchestration")
    Component(rec_svc, "RecommendationService", "Rule engine + ML model")
    Component(admin_svc, "AdminService", "CMS operations")
  }

  Container_Boundary(ai, "AI Layer — Oracle Cloud") {
    Component(ollama, "Ollama", "LLM inference server")
    Component(llama3, "Llama 3 8B", "Conversational AI model")
    Component(deepseek, "DeepSeek R1 7B", "SEO content generation")
    Component(langchain, "LangChain", "Prompt templates, RAG pipeline")
    Component(chroma, "ChromaDB", "Vector embeddings store")
    Component(sklearn, "scikit-learn", "ML recommendation model")
  }

  Container_Boundary(data, "Data Layer") {
    Component(postgres, "PostgreSQL", "Primary relational store (Supabase)")
    Component(redis, "Redis", "Cache, sessions, rate limiting")
    Component(opensearch, "OpenSearch", "Full-text + filtered search")
    Component(r2, "Cloudflare R2", "Image and media storage")
  }

  Rel(pages, api, "HTTPS REST / WebSocket", "JSON")
  Rel(api, catalog_svc, "calls")
  Rel(api, search_svc, "calls")
  Rel(api, compare_svc, "calls")
  Rel(api, tco_svc, "calls")
  Rel(api, lead_svc, "calls")
  Rel(api, user_svc, "calls")
  Rel(api, ai_svc, "calls")
  Rel(api, rec_svc, "calls")
  Rel(api, admin_svc, "calls")

  Rel(ai_svc, langchain, "orchestrates")
  Rel(langchain, ollama, "inference requests")
  Rel(langchain, chroma, "vector similarity search")
  Rel(rec_svc, sklearn, "model.predict()")

  Rel(catalog_svc, postgres, "SQL queries")
  Rel(search_svc, opensearch, "search queries")
  Rel(api, redis, "cache get/set")
  Rel(pages, r2, "image URLs via Cloudflare CDN")
```

---

## 3. Data Flow Diagram

```mermaid
flowchart TD
    subgraph USER["User Journey"]
        U1([Browser]) -->|HTTPS| CF[Cloudflare CDN]
        CF -->|Cache HIT| U1
        CF -->|Cache MISS| VER[Vercel Edge]
        VER -->|Server Component| NXT[Next.js App Router]
    end

    subgraph FRONTEND["Next.js Frontend"]
        NXT --> SSG[SSG Page\nbrand/model/variant]
        NXT --> ISR[ISR Page\ncar listing]
        NXT --> CSR[CSR Component\ncomparison/tools]
    end

    subgraph API["FastAPI Backend — Oracle Cloud"]
        SSG & ISR & CSR -->|REST /api/v1/*| NGINX[Nginx Proxy]
        NGINX --> FAPI[FastAPI Router]
        FAPI -->|Auth middleware| JWT_MW[JWT Validator]
        JWT_MW --> SVC[Business Services]
    end

    subgraph CACHE["Cache Layer — Redis"]
        SVC -->|Cache check| REDIS[(Redis)]
        REDIS -->|HIT| SVC
        REDIS -->|MISS| DB_LAYER
    end

    subgraph DB_LAYER["Data Layer"]
        SVC --> PG[(PostgreSQL\nSupabase)]
        SVC --> OS[(OpenSearch)]
        SVC --> R2[(Cloudflare R2\nImages)]
    end

    subgraph AI_LAYER["AI Layer — Oracle Cloud"]
        SVC -->|Recommendation request| RULE[Rule Engine]
        RULE -->|Complex query| LC[LangChain]
        LC --> OL[Ollama\nLlama 3 8B]
        LC --> CHROMA[(ChromaDB\nVector Store)]
        SVC -->|ML predict| SKL[scikit-learn Model]
    end

    subgraph LEADS["Lead Flow"]
        SVC -->|Write lead| PG
        SVC -->|Send email| SMTP[Brevo SMTP]
        SMTP -->|Notification| DEALER([Dealer])
    end
```

---

## 4. User Interaction Sequence — AI Advisor

```mermaid
sequenceDiagram
    participant U as User Browser
    participant NXT as Next.js
    participant API as FastAPI
    participant RULE as Rule Engine
    participant LC as LangChain
    participant OL as Ollama (Llama 3)
    participant CHROMA as ChromaDB
    participant PG as PostgreSQL

    U->>NXT: Fill wizard (budget, city, fuel, seating...)
    NXT->>API: POST /api/v1/recommend
    API->>RULE: evaluate(inputs)
    RULE->>PG: SELECT cars WHERE price BETWEEN ... AND fuel=... AND seats>=...
    PG-->>RULE: [car_ids: 15 candidates]
    RULE-->>API: top 3 scored cars (< 100ms)

    opt LLM Explanation Requested
        API->>LC: explain_recommendation(cars, user_inputs)
        LC->>CHROMA: similarity_search(user_query)
        CHROMA-->>LC: relevant car data chunks
        LC->>OL: generate(prompt + context)
        OL-->>LC: stream tokens
        LC-->>API: explanation text
    end

    API-->>NXT: {recommendations: [...], explanation: "..."}
    NXT-->>U: Render recommendation cards (SSE stream)
```

---

## 5. Deployment Architecture (Text Representation)

```
┌─────────────────────────────────────────────────────────────────┐
│                         INTERNET                                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                  ┌────────▼────────┐
                  │   Cloudflare    │  DNS + CDN + DDoS + R2
                  │  (Free Tier)    │  Storage
                  └────────┬────────┘
                           │
          ┌────────────────┼────────────────────┐
          │                │                    │
  ┌───────▼──────┐  ┌──────▼──────┐   ┌────────▼──────┐
  │    Vercel    │  │   GitHub    │   │  Oracle Cloud  │
  │  (Free Tier) │  │  (Actions)  │   │  Always Free   │
  │              │  │  CI/CD      │   │  ARM VM        │
  │  Next.js 14  │  └─────────────┘   │  4 OCPUs 24GB  │
  │  App Router  │                    │                │
  │  TypeScript  │                    │  ┌───────────┐ │
  │  Tailwind    │                    │  │  Nginx    │ │
  │  ShadCN UI   │◄───────────────────┤  │  Proxy    │ │
  └──────────────┘   API calls HTTPS  │  └─────┬─────┘ │
                                      │        │       │
                                      │  ┌─────▼─────┐ │
                                      │  │  FastAPI  │ │
                                      │  │  Python   │ │
                                      │  └─────┬─────┘ │
                                      │        │       │
                              ┌───────┴──┬─────┴──┬────┴──────┐
                              │          │        │           │
                        ┌─────▼──┐ ┌────▼───┐ ┌──▼──────┐ ┌──▼────┐
                        │ Redis  │ │OpenSrch│ │ Ollama  │ │Prom + │
                        │ Cache  │ │ Search │ │+LangChn │ │Grafana│
                        └────────┘ └────────┘ │+ChromaDB│ │ Loki  │
                                              └─────────┘ └───────┘
                              │
                     ┌────────▼────────┐
                     │    Supabase     │
                     │  (Free Tier)    │
                     │  PostgreSQL 16  │
                     └─────────────────┘
```

---

*Part of Phase 1 HLD. See: [HLD.md](HLD.md) | [DeploymentDiagram.md](DeploymentDiagram.md) | [SecurityArchitecture.md](SecurityArchitecture.md)*
