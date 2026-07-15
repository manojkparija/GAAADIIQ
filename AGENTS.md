# GAADIIQ

Monorepo: `apps/web` (Next.js 16 frontend) + `apps/api` (FastAPI backend). Root uses npm
workspaces + Turbo. See `README.md` for the product overview and `docs/` for design docs.

## Cursor Cloud specific instructions

Toolchain: Node 22 + npm 10, Python 3.12. The startup update script installs all dependencies
(web via `npm install` at the repo root; API into the virtualenv at `apps/api/.venv`), so a fresh
pod already has them.

### Dependency gotchas (already handled by the update script)
`apps/api/requirements*.txt` is incomplete / has an incompatible transitive pin. The update script
additionally installs, into `apps/api/.venv`:
- `email-validator` — required at import time by Pydantic `EmailStr` (the API will not even boot
  without it).
- `boto3` — imported at module load by `services/storage.py`.
- `aiosqlite` — the pytest suite runs against in-memory SQLite.
- `bcrypt==4.0.1` — `passlib==1.7.4` is incompatible with `bcrypt>=5`; with bcrypt 5 every password
  hash raises `ValueError: password cannot be longer than 72 bytes`. Keep bcrypt pinned to 4.0.1.

### Environment files (gitignored — recreate if missing)
- `apps/web/.env.local` — copy from `apps/web/.env.example`; set `AUTH_SECRET` (e.g.
  `openssl rand -base64 32`). `NEXT_PUBLIC_API_URL=http://localhost:8000`.
- `apps/api/.env` — copy from `apps/api/.env.example`; set `DATABASE_URL` to the local Postgres
  (`postgresql+asyncpg://postgres:postgres@localhost:5432/gaadiiq`) and a `SECRET_KEY`.

### Running the services (do NOT put these in the update script)
- API: `cd apps/api && .venv/bin/uvicorn main:app --reload --port 8000` — Swagger UI at
  `http://localhost:8000/docs`.
- Web: `cd apps/web && npm run dev` (port 3000). `npm run dev` at the repo root runs both via Turbo.

### PostgreSQL (required for all DB-backed endpoints: auth, listings, dealers, etc.)
Postgres 16 is preinstalled but not auto-started. Start it and (re)create the schema:
```bash
sudo pg_ctlcluster 16 main start          # start the server
# DB "gaadiiq" + role postgres/postgres already exist in the snapshot.
```
There are **no Alembic migrations** (`alembic/versions` is empty) and **`seed.py` is broken**
(it imports `core.database` / `hash_password` that do not exist). Create tables directly from the
models when needed:
```bash
cd apps/api && PYTHONPATH=. .venv/bin/python - <<'PY'
import asyncio, models
from db.base import Base
from db.session import engine
async def main():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
asyncio.run(main())
PY
```
Tests do **not** need Postgres (they use in-memory SQLite via a dependency override).

### Lint / test / build (see `.github/workflows/` for the canonical CI commands)
- API tests: `cd apps/api && .venv/bin/pytest tests/`. 6 tests currently fail pre-existing
  (they assert `401` for missing auth but `HTTPBearer` returns `403` in the pinned Starlette).
- API lint `ruff check .` and web `npm run lint` both report **pre-existing** errors — the linters
  themselves work; the errors are in the committed code.
- `npm run type-check` and `npm run build` (in `apps/web`) both pass.
