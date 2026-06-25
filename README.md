# GAADIIQ — India's AI-First Automotive Intelligence Platform

Monorepo powering [gaadiiq.com](https://gaadiiq.com) — AI-driven car discovery, valuation, loan comparison, and dealer intelligence.

## Structure

```
GAAADIIQ/
├── apps/
│   ├── web/          # Next.js 14 frontend → Vercel
│   └── api/          # FastAPI backend → Oracle Cloud
├── packages/
│   └── shared/       # Shared TypeScript types & utilities
├── docs/             # All phase documentation
└── carlytics/        # Legacy prototype (reference only)
```

## Tech Stack

| Layer      | Technology                              | Hosting              |
|------------|-----------------------------------------|----------------------|
| Frontend   | Next.js 14, TypeScript, Tailwind, ShadCN| Vercel (free)        |
| Backend    | FastAPI, Python 3.12                    | Oracle Cloud Free    |
| Database   | PostgreSQL                              | Supabase Free        |
| Cache      | Redis                                   | Oracle Cloud         |
| Search     | OpenSearch                              | Oracle Cloud         |
| AI         | Ollama + Llama 3 + DeepSeek + LangChain | Self-hosted          |
| Auth       | JWT + NextAuth                          | —                    |
| Storage    | Cloudflare R2                           | Free (10 GB)         |
| Monitoring | Prometheus + Grafana + Loki             | Oracle Cloud         |
| CI/CD      | GitHub Actions                          | Free                 |

## Getting Started

### Prerequisites
- Node.js ≥ 20
- Python 3.12+
- npm ≥ 10

### Install

```bash
npm install
```

### Run locally

```bash
# Frontend
cd apps/web && npm run dev

# Backend
cd apps/api
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

## Phase Progress

| Phase | Title                        | Status      |
|-------|------------------------------|-------------|
| 0     | Vision & Competitor Analysis | ✅ Complete |
| 1     | PRD & BRD                    | ✅ Complete |
| 2     | HLD & LLD                    | ✅ Complete |
| 3     | Repository Setup             | 🚧 In Progress |
| 4–15  | Feature development          | Pending     |
