# GAADIIQ

Indian car marketplace. Angular 17 (standalone components, signals) on Vercel;
FastAPI + SQLAlchemy async on Render; Postgres on Supabase.

```
apps/gaadiiq-angular    web app          -> Vercel
apps/api                FastAPI service  -> Render (Docker)
```

Railway is **not** used. Render and Vercel both deploy from `master`.

---

## Read this first

**`docs/ENGINEERING_BACKLOG.md`** — the known sharp edges, each with the
evidence behind it. Several are traps that have already cost a production
outage. In particular:

- **Schema lives in two places.** 25 Alembic migrations *and* hand-run
  `schema_setup_batch*.sql` files at the repo root. The marketplace and loan
  tables exist only in the SQL files, so shipping code that needs them does not
  ship the tables. Check both before assuming a table exists.
- **CI runs on SQLite, production on Postgres.** Green CI says nothing about
  native enums, `NOT NULL` behaviour, or casting.
- **Playwright is configured but never runs in CI.** Browser verification is
  manual, and it is the only thing that catches a class of bug `ng build`
  cannot.

## Conventions worth knowing

- `interceptors/auth.interceptor.ts` attaches the Supabase token to every
  request aimed at `environment.apiUrl`. **Never set `Authorization` manually** —
  it shadows the interceptor.
- `computed()` tracks **signal reads only**. A `computed()` over a plain field
  bound with `ngModel` evaluates once and then reports a stale answer forever.
  This has been shipped twice. Use a method instead.
- **No `from __future__ import annotations` in FastAPI routers.** It breaks
  signature introspection and body params get read as query params.
- Images resolve onto catalogue cars by **make + model + year, all three exact**
  (`services/media_library.py`). A stray spelling silently detaches a gallery
  with no error.
- `cars.id` is a **UUID** in the ORM. Batch 1 SQL says `bigint`; the ORM wins.
- Run `ruff check .` over the whole tree, not per-file — CI does, and import
  order (I001) fails on files you did not touch.
- Test classes must be named `Test*Suite` or `Test*Case` (`pyproject.toml`).
  Anything else collects **zero tests** and passes silently. Prefer plain
  functions.
- CSS theme tokens: `--primary` `#2F6BFF`, `--teal` `#14B8A6`, plus
  `--fill-dim`, `--divider`, `--text-muted`. Page content clears the fixed
  navbar with `padding-top: max(7rem, var(--nav-offset))` (LAY-007).

## Sensitive data

- **Aadhaar is never stored.** Validated (Verhoeff), then only a peppered
  SHA-256 digest and the last four digits survive. Aadhaar Act s.29(4) makes
  storing the number an offence for a private entity.
- **PAN is stored** — a lender cannot act on a hash — but never returned. Every
  response carries `ABCDE****F`.
- **No credit score is ever invented.** `services/credit_bureau.py::fetch_score`
  raises rather than returning a plausible number. A generated score is
  indistinguishable from a real one at the call site and would be believed.

## Verifying work

`ng build` and a green test suite do not tell you a page works. Run the app and
look at it — and scroll the whole page, not just the part you changed. When
reporting to the user, distinguish what you **measured** from what you
**reasoned about**; they are different confidence levels and the difference is
not visible in how a claim is phrased.
