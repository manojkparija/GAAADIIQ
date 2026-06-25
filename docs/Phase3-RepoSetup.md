# Phase 3 — Repository Setup

**Status:** Complete  
**Date:** 2026-06-25

---

## What Was Done

### 1. Monorepo Initialization
- Initialized git repository at project root
- Created Turborepo monorepo structure with `apps/` and `packages/` workspaces
- Root `package.json` with npm workspaces + Turbo task pipeline
- `.gitignore` covering Node, Python, Next.js build artifacts, and env files

### 2. Frontend — `apps/web`
- **Framework:** Next.js (latest) with TypeScript, Tailwind CSS v4, App Router
- **UI Library:** ShadCN UI (initialized with defaults, `Button` component added)
- **Homepage stub:** Hero section, CTA buttons, feature card grid
- **Package name:** `@gaadiiq/web`
- Scripts: `dev` (port 3000), `build`, `lint`, `type-check`, `test`

### 3. Backend — `apps/api`
- **Framework:** FastAPI + Uvicorn
- **Settings:** Pydantic Settings v2 with `.env` support
- **Structure:**
  ```
  apps/api/
  ├── main.py          # App entry point, CORS, router registration
  ├── core/
  │   └── config.py   # Pydantic settings (DB, Redis, JWT, CORS)
  ├── routers/
  │   └── health.py   # GET /health — status, timestamp, version
  ├── models/          # SQLAlchemy ORM models (Phase 4+)
  ├── services/        # Business logic layer (Phase 4+)
  ├── db/              # DB session, migrations (Phase 4+)
  └── tests/
      └── test_health.py  # 2 passing async tests
  ```
- **Tests:** 2/2 passing (health check + root endpoint)
- `.env.example` provided with all required config keys

### 4. CI/CD — GitHub Actions
| Workflow | Trigger | Jobs |
|---|---|---|
| `ci-web.yml` | Push/PR to `apps/web/**` | Lint → Type-check → Build → Deploy to Vercel (main only) |
| `ci-api.yml` | Push/PR to `apps/api/**` | Lint (ruff) → Pytest → Deploy to Oracle Cloud via SSH (main only) |

---

## How to Run Locally

### Frontend
```bash
cd apps/web
npm install
npm run dev        # http://localhost:3000
```

### Backend
```bash
cd apps/api
python -m venv .venv
.venv\Scripts\activate    # Windows
# source .venv/bin/activate  # macOS/Linux
pip install -r requirements-dev.txt
cp .env.example .env      # fill in your values
uvicorn main:app --reload  # http://localhost:8000
```

### API Docs
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

---

## Secrets Required for CI/CD

| Secret | Used By | Purpose |
|---|---|---|
| `VERCEL_TOKEN` | ci-web | Vercel deploy auth |
| `VERCEL_ORG_ID` | ci-web | Vercel organization |
| `VERCEL_PROJECT_ID` | ci-web | Vercel project |
| `ORACLE_HOST` | ci-api | Oracle Cloud VM IP |
| `ORACLE_USER` | ci-api | SSH username |
| `ORACLE_SSH_KEY` | ci-api | Private SSH key |

---

## Next: Phase 4
Database setup — Supabase PostgreSQL schema, Alembic migrations, SQLAlchemy models for `cars`, `users`, `dealers`, `listings`.
