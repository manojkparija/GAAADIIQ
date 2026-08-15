# Claude Code Prompt — Fix Render `alembic upgrade head` startup crash

Paste the block below into Claude Code.

```
# ROLE
You are fixing a production-blocking Alembic migration failure on GAADIIQ
(Render service gaadiiq-api). Do NOT reinvent the app. Fix the migration
chain and startup so `alembic upgrade head` succeeds against the existing
Supabase Postgres, then the API boots.

# SYMPTOM (Render logs)
Application lifespan runs:
  subprocess.run(["alembic", "upgrade", "head"], cwd=apps/api, check=True, timeout=15)
Alembic exits non-zero → CalledProcessError → in production main.py RE-RAISES
→ "ERROR: Application startup failed. Exiting."

# ROOT CAUSE (confirmed — do not ignore)
1) TWO migration folders exist:
   - apps/api/alembic/versions/   ← ONLY folder Alembic loads (alembic.ini
     script_location = alembic). Linear chain 0001→…→0010. HEAD = 0010.
   - apps/api/migrations/versions/ ← ORPHAN. Contains:
       0003_add_vehicle_media_versions.py  (rev='0003', down='0002')  COLLIDES
       0004_add_vehicle_media_audit.py     (rev='0004', down='0003')  COLLIDES
       0011_add_wave3_ml_fields.py         (rev='0011', down='0010')  NEVER LOADED
     alembic.ini does NOT set version_locations to this folder.

2) Prior "fixes" only renumbered files inside the orphan folder (e.g. 0005→0011).
   Alembic never saw them → deploy kept failing / schema stayed incomplete.

3) Likely DB drift: schema_setup_batch*.sql created tables with IF NOT EXISTS,
   while alembic/versions/0008_brochure_ingestion.py uses bare op.create_table
   (no IF NOT EXISTS). If alembic_version lags but tables exist →
   "relation already exists" → exit 1.

4) Production treats any Alembic failure as fatal (by design in main.py).

# READ FIRST
- apps/api/alembic.ini
- apps/api/alembic/env.py
- apps/api/main.py (lifespan alembic block)
- apps/api/alembic/versions/* (real chain)
- apps/api/migrations/versions/* (orphan — must be absorbed or deleted)
- docs/qa/ops/Claude_Fix_Prompt_Alembic_Startup.md (this file)
- SCHEMA_SETUP_INSTRUCTIONS.md (context for drift)

# DO NOT
- Do not keep a second migrations/ folder as the source of truth.
- Do not reuse revision IDs 0003/0004 for media versions/audit.
- Do not stamp head blindly without verifying tables/columns.
- Do not print full DATABASE_URL (password) in logs — truncate/redact.
- Do not break brochure/media app code that already imports
  VehicleMediaVersion / VehicleMediaAudit / WAVE3 columns.

# IMPLEMENTATION PLAN

## Step 1 — Unify onto apps/api/alembic/versions/
Move orphan content into the REAL chain with NEW revision IDs:

  0010 (existing head: admin_image_metadata)
    → 0011_vehicle_media_versions.py   (from migrations/.../0003_add_vehicle_media_versions.py)
    → 0012_vehicle_media_audit.py      (from migrations/.../0004_add_vehicle_media_audit.py)
    → 0013_wave3_ml_fields.py          (from migrations/.../0011_add_wave3_ml_fields.py)

Rules:
- revision / down_revision must form one linear chain ending at 0013.
- Make upgrade() IDEMPOTENT for Postgres:
  - CREATE TABLE IF NOT EXISTS
  - CREATE TYPE / ENUM safely (DO $$ … IF NOT EXISTS … or catch DuplicateObject)
  - ADD COLUMN IF NOT EXISTS
  - CREATE INDEX IF NOT EXISTS
- After files exist under alembic/versions/, DELETE apps/api/migrations/
  (or leave a README pointing to alembic/versions only — prefer delete to
  stop future wrong-folder edits).
- Update docs/IMPLEMENTATION_STATUS.md paths that say migrations/versions/.

## Step 2 — Prove the graph
From apps/api:
  alembic heads          # must show single head 0013
  alembic history        # 0001 … 0013 linear, no branches
Fail the PR if multiple heads or duplicate revision IDs exist.

## Step 3 — Handle already-provisioned Supabase safely
Provide a documented recovery path for the live DB (and automate where safe):

A) If alembic_version is behind but tables from 0008/0009/0010 already exist:
   - Prefer making those migrations idempotent (Step 1) so re-run succeeds, OR
   - One-time: alembic stamp <rev> only after verifying objects exist
     (document exact SQL checks). Never stamp 0013 unless WAVE3 columns exist.

B) Add a small script or make target, e.g.:
   scripts/check_alembic_drift.py
   that prints current alembic_version + whether vehicle_media /
   vehicle_media_versions / vehicle_media_audit / WAVE3 columns exist.

## Step 4 — Startup hardening (minimal, keep prod strict)
In apps/api/main.py lifespan:
- Keep failing fast in production if migrations fail (good).
- Log alembic stdout AND stderr (already partially there) — ensure stderr
  is visible in Render.
- Raise subprocess timeout from 15s to something realistic for Supabase
  (e.g. 60–120s). 15s is too tight for cold remote DB + several migrations.
- REDACT secrets: do not print full DATABASE_URL. Log host + db name only.
- Optionally run `python -m alembic` instead of bare `alembic` for PATH safety.

## Step 5 — SSL / URL for Supabase (if connect errors appear)
If stderr shows SSL/connection failures:
- Ensure async URL used by alembic/env.py works with Supabase
  (sslmode=require / asyncpg ssl as appropriate).
- Align apps/api/db/session.py connect_args with Supabase needs
  (today it forces ssl=False for Postgres — verify this is not breaking
  migrations or runtime against Supabase; fix if required).
Do not weaken security; require SSL for Supabase hosts.

## Step 6 — Tests / CI
- Unit/integration: assert alembic heads == one revision.
- If feasible: run alembic upgrade head against a disposable Postgres in CI
  (empty DB) and against a DB pre-seeded with schema_setup_batch3 SQL
  (drift case) — both must succeed after idempotent migrations.
- Keep existing media/API tests green.

# ACCEPTANCE
1. `cd apps/api && alembic heads` → single head `0013` (or final id you choose).
2. Fresh Postgres: `alembic upgrade head` succeeds; vehicle_media,
   vehicle_media_versions, vehicle_media_audit, WAVE3 columns present.
3. Drift case (tables exist, alembic_version old/empty): upgrade head succeeds
   without DuplicateTable.
4. Render deploy: lifespan migration succeeds; API stays up.
5. No password/full DATABASE_URL in logs.
6. apps/api/migrations/versions orphan chain gone or clearly deprecated.
7. Brief note in docs/qa/ops/ or IMPLEMENTATION_STATUS.md explaining the
   single-chain rule: ALL future migrations go ONLY in alembic/versions/.

# DONE
Summarize: new revision IDs, what was deleted, how to recover the live
Supabase DB in one short runbook (stamp vs upgrade), and Render verify steps.
```

---

## Compact one-liner (if chat is short)

```
Render dies on alembic upgrade head because WAVE2/3 migrations live in
apps/api/migrations/versions (orphan; colliding rev 0003/0004) while Alembic
only loads alembic/versions (head 0010). Move versions/audit/wave3 into
alembic/versions as 0011→0012→0013 (idempotent), delete orphan folder,
raise migration timeout, redact DATABASE_URL logs, fix Supabase SSL if needed.
Read docs/qa/ops/Claude_Fix_Prompt_Alembic_Startup.md. Do not stamp blindly.
```
