# GAADIIQ.COM — Deployment Diagram

**Version:** 1.0  
**Date:** 2026-06-24

---

## 1. Environment Overview

| Environment | Purpose | Infrastructure |
|---|---|---|
| `local` | Developer machine | Docker Compose (all services) |
| `staging` | Pre-prod validation | Oracle Cloud (same VM, different port) |
| `production` | Live platform | Vercel + Oracle Cloud + Supabase + Cloudflare |

---

## 2. Production Deployment Diagram

```mermaid
graph TB
    subgraph DNS["DNS — Cloudflare"]
        CF_DNS[gaadiiq.com\napi.gaadiiq.com\ncdn.gaadiiq.com]
    end

    subgraph VERCEL["Vercel — Frontend"]
        V_EDGE[Vercel Edge Network\n50+ global PoPs]
        V_FUNC[Next.js Server Functions\nAPI Routes]
        V_STATIC[Static Asset Cache\nSSG / ISR Pages]
    end

    subgraph CF["Cloudflare — CDN + Storage"]
        CF_CDN[CDN Cache\nEdge Caching]
        CF_R2[R2 Object Storage\nCar Images / Media\n10GB Free]
        CF_WAF[WAF + DDoS Protection]
    end

    subgraph ORACLE["Oracle Cloud Always-Free ARM VM\n4 OCPUs · 24GB RAM · Ubuntu 22.04"]
        NGINX_PROD[Nginx\nSSL Termination\nRate Limiting\n:443]

        subgraph DOCKER["Docker Compose — Production"]
            FAPI_PROD[FastAPI\nuvicorn workers × 4\n:8000]
            REDIS_PROD[Redis 7\nPersistence: AOF\n:6379]
            OS_PROD[OpenSearch\n2GB heap\n:9200]
            OLLAMA_PROD[Ollama\nLlama 3 8B\n:11434]
            CHROMA_PROD[ChromaDB\n:8001]
            PROM[Prometheus\n:9090]
            GRAFANA[Grafana\n:3001]
            LOKI[Loki\n:3100]
        end
    end

    subgraph SUPABASE["Supabase — Managed PostgreSQL"]
        PG_PROD[PostgreSQL 16\nConnection Pooler: PgBouncer\nBackups: Daily]
    end

    subgraph GITHUB["GitHub"]
        GH_REPO[Source Repository\nmain branch]
        GH_ACTIONS[GitHub Actions\nCI/CD Pipelines]
    end

    CF_DNS -->|gaadiiq.com| VERCEL
    CF_DNS -->|api.gaadiiq.com| CF_WAF
    CF_DNS -->|cdn.gaadiiq.com| CF_CDN

    CF_WAF --> NGINX_PROD
    CF_CDN --> CF_R2
    VERCEL --> CF_CDN

    NGINX_PROD --> FAPI_PROD
    FAPI_PROD --> REDIS_PROD
    FAPI_PROD --> OS_PROD
    FAPI_PROD --> OLLAMA_PROD
    FAPI_PROD --> CHROMA_PROD
    FAPI_PROD --> PG_PROD

    PROM --> FAPI_PROD
    PROM --> NGINX_PROD
    GRAFANA --> PROM
    GRAFANA --> LOKI

    GH_REPO --> GH_ACTIONS
    GH_ACTIONS -->|Deploy frontend| VERCEL
    GH_ACTIONS -->|Deploy backend| ORACLE
```

---

## 3. Local Development Deployment

```mermaid
graph TB
    subgraph LOCAL["Developer Machine — Docker Compose"]
        NXT_DEV[Next.js Dev Server\n:3000\nHot Reload]
        FAPI_DEV[FastAPI Dev Server\n:8000\nuvicorn --reload]
        REDIS_DEV[Redis\n:6379]
        OS_DEV[OpenSearch\n:9200]
        OLLAMA_DEV[Ollama\n:11434]
        CHROMA_DEV[ChromaDB\n:8001]
        PG_DEV[PostgreSQL\n:5432\nLocal Docker]
        ADMINER[Adminer DB UI\n:8080]
    end

    Browser -->|localhost:3000| NXT_DEV
    NXT_DEV -->|localhost:8000| FAPI_DEV
    FAPI_DEV --> REDIS_DEV
    FAPI_DEV --> OS_DEV
    FAPI_DEV --> OLLAMA_DEV
    FAPI_DEV --> CHROMA_DEV
    FAPI_DEV --> PG_DEV
    Browser -->|localhost:8080| ADMINER
```

---

## 4. CI/CD Pipeline

```mermaid
flowchart LR
    A[Developer / AI\npushes to GitHub] --> B{Branch?}

    B -->|feature/*| C[CI: Lint + Type Check\n+ Unit Tests]
    C -->|pass| D[PR Created]
    D -->|merged to main| E[CI: Full Test Suite\nUnit + Integration + API]

    B -->|main| E
    E -->|pass| F[Build Docker Image\n+ Next.js Build]
    F -->|pass| G{Deploy Target}

    G -->|Frontend| H[Vercel Deploy\nAuto via GitHub integration]
    G -->|Backend| I[SSH to Oracle Cloud\ndocker compose pull\ndocker compose up -d]

    H & I --> J[Smoke Tests\nHealth check /api/health]
    J -->|pass| K[✅ Production Live]
    J -->|fail| L[🔴 Rollback\ndocker compose up -d prev_image]
```

---

## 5. Docker Container Map

| Container | Image | CPU Limit | Memory Limit | Persistent Volume |
|---|---|---|---|---|
| `gaadiiq-api` | `python:3.12-slim` + app | 2 CPU | 4GB | `./logs` |
| `gaadiiq-redis` | `redis:7-alpine` | 0.5 CPU | 512MB | `redis-data` |
| `gaadiiq-opensearch` | `opensearchproject/opensearch:2` | 1 CPU | 2GB | `os-data` |
| `gaadiiq-ollama` | `ollama/ollama` | 2 CPU | 8GB | `ollama-models` |
| `gaadiiq-chromadb` | `chromadb/chroma` | 0.5 CPU | 1GB | `chroma-data` |
| `gaadiiq-prometheus` | `prom/prometheus` | 0.25 CPU | 256MB | `prom-data` |
| `gaadiiq-grafana` | `grafana/grafana` | 0.25 CPU | 256MB | `grafana-data` |
| `gaadiiq-loki` | `grafana/loki` | 0.25 CPU | 256MB | `loki-data` |
| `gaadiiq-nginx` | `nginx:alpine` | 0.25 CPU | 128MB | — |

**Total:** ~7 CPU, ~16.5GB RAM — within Oracle Free Tier (4 OCPUs, 24GB).  
Note: Ollama and API share CPU; Ollama only active during AI inference requests.

---

## 6. Network Architecture

```
Public Internet
    │
    ▼
Cloudflare WAF (DDoS, bot protection)
    │
    ▼
Oracle Cloud VM — Public IP
    │
Nginx (:443) — SSL termination
    │  └── Certbot / Let's Encrypt (free SSL)
    │
    ├──► FastAPI (:8000) — internal Docker network only
    │
    └── Firewall Rules (OCI Security List):
          Inbound:  80 (redirect), 443 (HTTPS), 22 (SSH — key-only)
          Outbound: All
          Internal: All containers communicate on gaadiiq-network bridge
```

---

## 7. Secrets & Configuration

| Secret | Storage | Access Method |
|---|---|---|
| DATABASE_URL (Supabase) | GitHub Actions Secret | Injected as env var at deploy time |
| JWT_SECRET_KEY | GitHub Actions Secret | Docker env |
| REDIS_PASSWORD | GitHub Actions Secret | Docker env |
| Google OAuth Client ID/Secret | GitHub Actions Secret | Docker env |
| Cloudflare R2 Access Key | GitHub Actions Secret | Docker env |
| SMTP API Key (Brevo) | GitHub Actions Secret | Docker env |
| Oracle SSH Private Key | GitHub Actions Secret | Used for deployment only |

All secrets encrypted at rest in GitHub Actions. No secrets in source code or Docker images.

---

*Part of Phase 1 HLD. See: [HLD.md](HLD.md) | [ArchitectureDiagram.md](ArchitectureDiagram.md) | [SecurityArchitecture.md](SecurityArchitecture.md)*
