# Claude Code Prompt — Fix catalogue `/cars` HTTP 504 (images missing until hard refresh)

Paste the block below into Claude Code.

```
# ROLE
You are fixing a production catalogue failure on GAADIIQ. Symptom looks like
"car images missing / 0 models available until hard refresh", but the real
fault is HTTP 504 on the catalogue list endpoint — not broken CDN images and
not the service worker.

Do NOT reinvent the app. Confirm what is already on master, verify it is
deployed, then close residual gaps so signed-in users stop seeing blank
catalogue cards after a normal reload.

# SYMPTOM (user / DevTools)
- New Cars (or home catalogue): placeholders / blank cards / "0 models".
- Hard refresh often restores the full catalogue with images.
- Network tab shows something like:
    GET …/cars?bucket=new&priced_only=true&page=1&page_size=100
    → HTTP 504 Gateway Timeout
- Outage panel (when lastFailure works) should already surface that path + 504.
- Render API logs may still show 200 OK for "the same" request. BOTH can be
  true: the query hung, the gateway answered 504 to the browser, and the
  worker finished later and logged 200. Do not treat server 200 as proof the
  browser got a body.

# ROOT CAUSE (confirmed — do not re-blame caches)
1) Primary (fixed on master as #223 / 4d80172, but VERIFY deploy):
   Supabase closes idle Postgres connections server-side. Without
   SQLAlchemy `pool_pre_ping`, the pool hands out a dead socket after quiet
   periods. The query waits until TCP gives up — minutes, past the gateway
   timeout → browser 504 → empty catalogue → no `image_urls` → blank cards.

2) Why it looked like "caching / hard refresh":
   - Signed-out traffic can be served from edge cache and never hit a dead
     origin connection.
   - Signed-in traffic carries Authorization → `core/cache_policy.py` stamps
     no-store → always hits origin → only path that meets dead pool sockets.
   - Hard refresh is just a *retry after a live connection exists*, not proof
     that Cache-Control was the root cause.

3) Prior tip fixes that are useful but NOT the root cause (#218–#222):
   shorter catalogue TTLs, auth interceptor fail-open, `_=` cache bust,
   `lastFailure` outage text, record failure on first non-retryable error.
   Keep them. Do not undo them. Do not spend another day on the SW.

# READ FIRST
- apps/api/db/session.py          (pool_pre_ping / pool_recycle — must stay)
- apps/api/tests/test_db_pool_suite.py
- apps/api/routers/cars.py
- apps/api/core/cache_policy.py
- apps/gaadiiq-angular/src/app/services/cars-data.service.ts
  (fetchOrNull retry: currently ONLY status === 0)
- apps/gaadiiq-angular/src/app/services/cars-data.service.spec.ts
- apps/gaadiiq-angular/src/app/interceptors/auth.interceptor.ts
- docs/qa/ops/Claude_Fix_Prompt_Cars_504.md (this file)
- git show 4d80172   (#223 commit message — full RCA)

# DO NOT
- Do not blame the Angular service worker for `/cars?bucket=…`.
  ngsw patterns are `/cars/.*` (slash after cars) and never match the list URL.
- Do not treat blank cards as a Cloudinary / media-CDN bug while `/cars` 504s.
  No catalogue rows ⇒ no image URLs. Fix the list fetch first.
- Do not remove `pool_pre_ping` / `pool_recycle` "to tidy" the engine kwargs.
- Do not remove the `_=` bust or lastFailure panel until production is clean
  for several days AND you have a written reason.
- Do not retry every 4xx. Retry only transient gateway / no-answer cases.
- Do not print full DATABASE_URL / secrets in logs.
- Do not "fix" by telling users to hard refresh.

# IMPLEMENTATION PLAN

## Step 0 — Confirm #223 is live on the environment that 504s
On the Render API that serves api.gaadiiq.com (or the preview under test):
1. Confirm the deployed git SHA includes 4d80172 / pool_pre_ping=True and
   pool_recycle=300 in apps/api/db/session.py (Postgres branch only).
2. Confirm apps/api/tests/test_db_pool_suite.py is present and green in CI.
3. If #223 is NOT deployed: deploy master first, reproduce once more, THEN
   only continue if 504 still appears. Do not stack more client hacks on an
   undeployed server fix.

## Step 1 — Keep / harden the pool (server)
In apps/api/db/session.py for non-SQLite:
- KEEP: pool_pre_ping=True, pool_recycle=300 (or tighter if evidence needs it).
- If 504 persists after deploy, add bounded statement / connect timeouts so a
  hung checkout cannot occupy a worker past the gateway:
  - prefer asyncpg / SQLAlchemy timeout knobs that fail fast and free the
    request, rather than waiting for TCP death.
  - keep ssl connect_args that already work with Supabase (ssl="require").
- Optional: short `/health/db` that does `SELECT 1` so ops can see dead pool
  without hitting `/cars`. Do not require auth for that probe if it only
  checks connectivity.

## Step 2 — Client: treat gateway timeouts as retryable
In CarsDataService.fetchOrNull today, only HttpErrorResponse status 0 is
retried (FETCH_ATTEMPTS=3, FETCH_RETRY_MS=250). A 504 is a *real* HTTP
answer, so the client gives up on attempt 1 — even though the next attempt
often succeeds once the pool has replaced the dead connection (or pre_ping
has run on a sibling request).

Change the retry predicate to also retry transient gateway statuses:
  status === 0 || status === 502 || status === 503 || status === 504

Keep:
- giving up immediately on other 4xx/5xx (do not retry 401/403/404/422/500)
- lastFailure set on the attempt you actually give up on (not only attempt 3)
- `_=` cache-bust still appended
- describeFailure() wording for 504 (path + HTTP 504 …)

Slightly increase FETCH_RETRY_MS for gateway retries if needed (e.g. 250 →
400–500ms) so the server has a beat to recycle; keep total wait short so a
real outage still surfaces the panel quickly.

## Step 3 — Empty / failed catalogue must not look like "no cars forever"
- Ensure a failed load leaves lastFailure non-empty and the outage / retry UI
  visible (already partly done in #221/#222 — regression-guard with specs).
- Do not cache a failed in-memory catalogue across soft navigations as if it
  were a successful empty list. null source ≠ empty items[].
- Retry button must call load() again (fresh `_=`), not only re-render locals.

## Step 4 — Tests (mandatory — these regress silently)
Server:
- Keep test_db_pool_suite.py assertions for pool_pre_ping and pool_recycle on
  Postgres kwargs, and NullPool on SQLite. If you add timeouts, assert them.

Client (Karma):
- Spec: fetchOrNull retries on HTTP 504 (and 502/503), succeeds on a later
  attempt, and does NOT retry on 404/500.
- Spec: lastFailure contains `/cars?…` and `504` when every attempt 504s.
- Spec: status 0 path still retries (existing).
- Spec: `_=` still appended; bucket/priced_only preserved.
- Re-run the "outage panel not blank" specs from #222.

## Step 5 — Verify against production-shaped behaviour
1. Local/CI: unit + Karma green; ng build green.
2. After deploy: signed-IN browser, leave idle > pool idle window, soft reload
   New Cars several times — must not show blank catalogue / must not need
   hard refresh.
3. If you can inject a dead connection in staging, confirm pre_ping recovers
   without a browser 504; if a 504 still slips through, confirm client retries
   recover without user action.
4. Confirm Render log vs browser: if browser got 200 with body, cards show
   images. If browser got 504, panel names 504 — never silent empty.

# ACCEPTANCE
1. Deployed API has pool_pre_ping=True and pool_recycle≤300 for Postgres.
2. Soft reload while signed in does not require hard refresh to show catalogue
   images after idle.
3. If `/cars` still 504s once, client retries and recovers without user ritual.
4. Persistent failure shows lastFailure with path + HTTP 504 (not blank panel).
5. test_db_pool_suite + new Karma 504-retry specs fail if someone removes the
   guards.
6. No new "clear SW / purge CDN" docs as the primary fix.

# DONE
Summarize: deploy SHA check for #223, any extra server timeout knobs, exact
client retry change, tests added, and a 3-bullet verify checklist for Render
+ signed-in soft reload.
```

---

## Compact one-liner (if chat is short)

```
Catalogue images missing until hard refresh is HTTP 504 on
/cars?bucket=new&priced_only=true&page=1&page_size=100 from dead Supabase
pool sockets (not CDN, not SW). Master #223 already adds pool_pre_ping +
pool_recycle=300 — confirm that SHA is deployed. If 504 remains: add fast
DB timeouts and make CarsDataService.fetchOrNull also retry 502/503/504
(not only status 0), keep lastFailure + tests. Read
docs/qa/ops/Claude_Fix_Prompt_Cars_504.md.
```

---

## Context for humans

| Item | Detail |
|------|--------|
| Symptom | Blank catalogue / missing images until hard refresh |
| Browser | `GET /cars?…` → **504** |
| API log | Often later **200** (hung query finished after gateway gave up) |
| Root fix | `#223` `pool_pre_ping` + `pool_recycle=300` in `apps/api/db/session.py` |
| Residual | Client retries only `status === 0` today; **504 is not retried** |
| False leads | Service worker, image CDN, edge cache alone |
