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
- **Playwright runs in CI for the `desktop-chrome` project only.**
  `.github/workflows/ci-web.yml` ("Build & smoke test") installs Chromium and
  runs `npx playwright test --project=desktop-chrome` on changes under
  `apps/gaadiiq-angular/**`. The three mobile device projects are still manual.
  CI starts no API, so a spec that needs a backend must skip when it is absent —
  adding one to `desktop-chrome`'s `testMatch` without that guard turns the web
  job red. (This line previously said Playwright never ran in CI. It does; the
  claim was wrong and had been repeated into four other documents.)

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
- Run `ruff check .` from `apps/api`, not per-file — import order (I001) fails
  on files you did not touch. That directory is what CI lints: `ci-api.yml`
  sets `working-directory: apps/api`. (This line used to say "over the whole
  tree — CI does". It does not, and the tree outside `apps/api` currently has
  27 ruff errors in `apps/pdf-ingestion`, `docs/qa` and `scripts` that CI has
  never seen — so a whole-tree run reports failures you did not cause and
  cannot interpret.)
- Test classes must be named `Test*Suite` or `Test*Case` (`pyproject.toml`).
  Anything else collects **zero tests** and passes silently. Prefer plain
  functions.
- CSS theme tokens: `--primary` `#295EE0`, `--teal` `#14B8A6`, plus
  `--fill-dim`, `--divider`, `--text-muted`. Page content clears the fixed
  navbar with `padding-top: max(7rem, var(--nav-offset))` (LAY-007) — both
  admin screens were missing it and rendered their own titles under the nav,
  which went unnoticed because they sit behind `adminGuard` and nobody had
  opened them in a browser.
- **Contrast is measured on the page, not on a swatch.** Small text sits on a
  tint of its own hue over `--navy`, several points lower than the same colour
  on white: `--primary` measured 4.50:1 on a white card and 4.27:1 in an 11px
  badge. `e2e/contrast.spec.ts` walks the rendered DOM and fails under AA.
  Light theme only for now — dark still has ~20 failures from hardcoded hexes
  (`#2563EB`, `#1E40AF`) that predate the tokens.
- For text on a coloured tint use the `--*-ink` tokens (`--success-ink`,
  `--warning-ink`, `--info-ink`, `--teal-ink`), not the brand colour. They are
  text-only counterparts that revert to the bright originals in dark mode.
- Every Playwright project declares a `testMatch`, so a new spec no pattern
  names runs nowhere and reports nothing — which looks exactly like passing.

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
