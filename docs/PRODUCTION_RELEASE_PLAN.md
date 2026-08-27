# Production release plan

Written 24 Aug 2026, from an audit of the code as it stands on `master`. Every
claim below is either a file reference or a measurement; where something is
unverified it says so.

The constraint that shapes this whole document: **once the code is in
production we cannot touch that environment again.** That rules out fixing
things by hand in the Render shell or the Supabase SQL editor after the fact,
which is how most of this codebase's schema currently gets changed. So the
release plan is mostly about making the environment reproducible before we
need it to be.

---

## Part 1 — What is already sound

Worth stating plainly, because a security review that lists only problems gives
no sense of proportion.

**Payments (`routers/payments.py`).** This is the strongest area of the code.

- HMAC-SHA256 signature verification on both the client callback (`/verify`)
  and the server-to-server webhook, using `hmac.compare_digest` — constant
  time, so it cannot be attacked by timing.
- No bypass in production. `_dev_mode()` requires `not settings.is_production`
  **and** absent keys; `_require_payments_available()` returns 503 rather than
  proceeding if production is missing keys.
- Idempotent. A replayed `/verify` or webhook for an already-paid record
  returns `already_paid` instead of double-crediting.
- Rate limited.
- Prices are server-side constants (`SUBSCRIPTION_PRICES`), not taken from the
  request — so a client cannot ask to pay ₹1 for a ₹2,999 tier.

**Secrets are not in the browser bundle.** No `service_role` key anywhere under
`apps/gaadiiq-angular/src` — checked. The one credential that does ship, the
Google Maps browser key, is public by design and protected by referrer
restriction; the environment files say so at length.

**Sensitive personal data.** Aadhaar is never stored — validated, then only a
peppered SHA-256 digest and last four digits survive (Aadhaar Act s.29(4)). PAN
is stored but never returned; every response carries `ABCDE****F`. No credit
score is ever invented — `services/credit_bureau.py::fetch_score` raises rather
than returning a plausible number.

**Transport and browser hardening.** `apps/gaadiiq-angular/vercel.json` sets
CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, a scoped
`Permissions-Policy`, and `upgrade-insecure-requests`.

**CORS is not a wildcard.** `core/config.py` lists explicit origins and matches
Vercel previews by an anchored pattern scoped to this project's own names —
deliberately not a blanket `.vercel.app`, because `allow_credentials` is true.

**Rate-limiting machinery exists** and is Redis-backed in production
(`core/limiter.py`), with the real client IP taken from `CF-Connecting-IP` then
`X-Forwarded-For`.

**CI is real.** `ci-api.yml` runs the suite twice — SQLite then Postgres 16 —
and diffs the migration chain against the models. `ci-web.yml` runs Playwright
`desktop-chrome`.

---

## Part 2 — Gaps, ranked by what they would actually cost

### G1 — 117 of 193 endpoints had no rate limit at all — **now closed**

Counted: 193 route decorators across `routers/`, 76 `@limiter.limit`
decorations, and the limiter constructed with **no `default_limits`** — so an
endpoint without an explicit decorator was unlimited. This was the single
largest exposure to the "millions of requests" scenario, and the undecorated set
included ordinary catalogue reads: the cheapest endpoints to discover, the most
expensive to serve, one database round trip each.

**Fixed** with `DEFAULT_LIMITS = ["300/minute"]` in `core/limiter.py`.

Deliberately generous. Five requests a second from one IP is beyond any human
browsing the site and still stops a flood dead. The temptation is to set it
tight and that is the wrong risk to take first: a limit set too high still
blocks the attack, while a limit set too low takes the site down for real users
at the exact moment anyone is watching. On a production we cannot reach into
afterwards those two failures are not symmetric. Tighten against observed
traffic later; endpoints needing something stricter already carry their own
decorator, which overrides the default rather than stacking with it.

**And the part that would have made it decorative.** `default_limits` are
enforced only by `SlowAPIMiddleware`, and this app registered the limiter and
the exception handler but **not the middleware**. Adding `default_limits` alone
would have looked like a fix, passed a test that reads the Limiter's attributes,
and left all 117 endpoints exactly as unlimited as before.

Found because the test drives a real undecorated route to a 429 instead of
inspecting configuration — the config assertions passed while the behaviour was
still broken. `app.add_middleware(SlowAPIMiddleware)` is now registered, before
`CORSMiddleware` so a 429 goes out with CORS headers; a rate-limit response the
browser may not read reaches the user as "could not reach the API" and sends
whoever investigates to the wrong machine.

### G2 — The limiter silently weakens itself under load

`_usable_storage_uri()` falls back to in-process memory when Redis is
unreachable. The docstring is honest about the cost: with N replicas the
effective limit is N times the configured one. It logs a warning — which nobody
is reading during an incident.

**Partly closed.** `core/limiter.py` now exposes `USING_MEMORY_STORAGE`, so the
condition is a value that can be read and alerted on rather than a line in a log
nobody opens during an incident. Wiring it to the health endpoint and deciding
whether Redis being down should fail *closed* for the most sensitive endpoints
(payments, OTP, upload) is still open.

### G3 — Nothing in front of the origin

An application-level limiter runs *after* the request has reached Python. It
cannot help with a volumetric flood: the process still parses every request. The
limiter reads `CF-Connecting-IP`, which implies Cloudflare was intended, but
nothing in `render.yaml` or the DNS setup in this repo shows it in place.

**The code half is done; the dashboard half is in `docs/CLOUDFLARE.md`.**
`REQUIRE_TRUSTED_PROXY` + `TRUSTED_PROXY_SECRET` make the API refuse anything
that did not arrive through Cloudflare — the origin lock in code, holding even
if Render's IP allow-list is misconfigured. Both switches must be set
deliberately, because a lock that activates on deploy against a service
Cloudflare is not yet fronting is a self-inflicted outage on the exact release
meant to harden things.

Still yours: the domain, the nameservers, the Transform Rule that injects the
secret, and Render's IP allow-list.

### G3a — the rate limiter's key could be chosen by the caller — **now closed**

Found while implementing the above, and worse than the gap it was meant to
close. `_real_ip` read `CF-Connecting-IP`, then the *first* element of
`X-Forwarded-For`, and trusted whichever it found — from anybody. Measured
against a 3/minute limit, six requests each carrying a different forged
`CF-Connecting-IP`:

```
same caller, no headers   [200, 200, 200, 429, 429, 429]
forged CF-Connecting-IP   [200, 200, 200, 200, 200, 200]
forged X-Forwarded-For    [200, 200, 200, 200, 200, 200]
```

Every request minted a fresh bucket. **The rate limiting shipped that morning
was defeated by one header** — worse than having none, because it looks like a
control.

The naive fix would have caused an outage of its own: Render terminates TLS, so
ignoring proxy headers puts every visitor behind one address and shares a single
300/minute bucket across the whole internet. So `CF-Connecting-IP` is trusted
only when the shared secret proves where the request came from, and
`X-Forwarded-For` is counted **from the right** — a proxy appends the peer it
actually saw, so anything the caller adds lands on the wrong side. Measured
after:

```
behind a proxy, forged XFF      [200, 200, 200, 429, 429, 429]
two genuine clients             [200, 200, 200, 200, 200, 200]
```

Forgery ineffective, and distinct clients still counted separately. Reverting
`_real_ip` to the original turns two of the eight tests red.

### G4 — No staging environment

`master` deploys straight to Render and Vercel. `docs/ENGINEERING_BACKLOG.md`
§5 records that when the catalogue went blank on 10 Aug, **the live site is
where it was discovered.**

Given the "cannot touch production afterwards" constraint, this is not
optional — it is the precondition for everything else. `docs/STAGING.md`
already specifies exactly what to create, including the two things that matter
most: staging must be **built by migrations rather than by hand**, and it must
not hold real applicant data (different `KYC_HASH_PEPPER`, no copied rows, no
live WhatsApp or payment credentials).

### G5 — No dependency scanning in CI — **now closed, and it found things**

Checked: no Dependabot, CodeQL, `pip-audit`, `npm audit`, gitleaks or
equivalent anywhere in `.github/`. Adding it was meant to be routine
configuration. It was not.

**What the first run found (24 Aug 2026):** 10 of 172 Python packages carried
advisories. Two were on security paths and were fixed immediately:

| Package | Was | Now | Why it mattered |
|---|---|---|---|
| `python-jose` | 3.3.0 | **3.4.0** | PYSEC-2024-232/233 — algorithm confusion and a decompression bomb in JWT handling. `core/security.py` signs and verifies our tokens with this. |
| `python-multipart` | 0.0.20 | **0.0.31** | Six advisories in multipart parsing, all shapes of resource exhaustion on the file-upload path — reachable by anyone who can POST. |

Both upgrades are in `requirements.txt` and the full suite passes on them.

**What remains, and why.** The gate is blocking, but only for advisories that
are *new*: today's set is frozen in `ci-api.yml`, with the list generated from a
real audit run rather than typed. Anything not on it fails the build.

- `pyasn1` — a fix exists (0.6.4) and **cannot be taken**: `python-jose` 3.4.0
  pins `pyasn1<0.5.0`. Installing it anyway produces a combination pip itself
  reports as incompatible. Waits on python-jose moving.
- `ecdsa` PYSEC-2026-1325 — no upstream fix; the maintainers consider the
  Minerva timing attack out of scope, and `python-jose[cryptography]` does not
  route our JWT work through it.
- `python-jose` PYSEC-2025-185 — no upstream fix exists.
- `starlette`, `langchain*`, `langsmith`, `pytest` — transitive, pinned by
  FastAPI and the LLM stack. Clearing them means moving those majors, which is
  scheduled work rather than a CI fix. **`starlette` is the one to schedule
  first**: nine advisories, and it is the HTTP layer every request passes
  through.

**On the web side**, a bare `npm audit` reports 59 findings — 37 high, 1
critical — and almost all of them are `webpack` and `@angular-devkit`, build
tooling that never reaches a browser. Gating on that number teaches everyone to
ignore the step. Restricted to what actually ships (`--omit=dev`) it is **12
high and 0 critical**, so the gate sits at critical: it passes today and fails
the moment something worse lands in the bundle. The 12 highs are real and need
an Angular ecosystem upgrade.

**Still open under this heading:** secret scanning. GitHub's push protection is
a repository setting rather than a workflow, so it is a dashboard action.

### G6 — `is_production` is one switch gating three different security behaviours

`settings.is_production` controls: the admin dev-bypass
(`core/dependencies.py:126` — an unauthenticated caller becomes a synthetic Dev
Admin when it is false), the payments dev-mode bypass, and whether the rate
limiter runs at all.

`render.yaml` pins `ENVIRONMENT: production` as a managed value, which is
correct. But the blast radius of that one string being wrong is: an open admin
API, auto-approved payments, and no rate limiting, simultaneously.

**Now closed, warn-only.** `Settings.environment_mismatch()` runs at startup,
*before* `validate_production_config()` and unconditionally.

That ordering is the point. `validate_production_config` opens with
`if not self.is_production: return` — every check it makes is gated on the one
flag most worth doubting, so a deployment with `ENVIRONMENT` unset or misspelt
skips all of them in silence. The new check asks the opposite question: not "are
we configured for production" but "does what we are connected to look like
production, whatever we called ourselves". It reasons from the database host.

Measured against the real `main.py` import:

```
warn-only, dev flag + remote DB   logs ENVIRONMENT MISMATCH, still boots
strict, same mismatch             RuntimeError: Refusing to start
ordinary local development        silent
```

The message names what is actually exposed rather than saying "mismatch":

> ENVIRONMENT is 'development' but the database is a remote host
> (db.x.supabase.co). In this mode the admin dependency grants a synthetic Dev
> Admin to unauthenticated callers, payments accept a dev bypass, and the rate
> limiter is disabled — against what looks like real data.

**`STRICT_ENVIRONMENT_CHECK` is off by default and that is deliberate.** The
check reasons from a heuristic, so it can be wrong in ways no test here would
reveal, and a refuse-to-boot heuristic that is wrong takes the service down on
the exact release meant to harden it. Deploy warn-only, read the log against a
real deployment, turn it on in a later release. `"Production"` with a capital P
is caught too — `is_production` is an exact string comparison, and nothing else
in the codebase would have noticed.

### G7 — Reviews are written from the browser straight to Supabase

Known and previously noted: the car-detail review path writes browser →
Supabase with `user_id: null` into a public bucket. That means review authorship
is unauthenticated and unattributable, and the bucket accepts writes from
anyone who can read the anon key — which is everyone, since it ships in the
bundle.

**Fix:** route it through the API like every other write, or tighten the RLS
policy so an insert requires an authenticated `auth.uid()`.

### G8 — Schema still has two sources of truth

`CLAUDE.md` names it: 25 Alembic migrations *and* hand-run
`schema_setup_batch*.sql` at the repo root, plus `supabase/migrations/*.sql`
that are applied by hand in the SQL editor — including `013_brand_logo_uploads.sql`
from today.

Under the "cannot touch production" rule this is the most dangerous structural
item in the codebase, because the current process for the Supabase half **is**
touching production by hand.

**Fix:** bring the `supabase/migrations` files under a runner (Supabase CLI
`db push` in CI against staging, then production) so that applying them is a
pipeline step with a record, not a paste into a browser.

### G9 — No audit log for admin actions

Task #16 has been pending throughout. Admin actions — approving a dealer image,
replacing a brand logo, changing a price — leave no trail. For a marketplace
handling money this matters both for incident response and for disputes.

### G10 — `.env.backup` was committed — **now closed**

`apps/api/.env.backup` is tracked. I checked its contents: **no live secrets** —
Razorpay, R2 and SMTP values are blank, Gemini is a placeholder. So this is not
a leak — it is the shape of an accident rather than one. Deleted, and
`.env.backup`, `.env.bak`, `.env.save` and `.env.*.backup` are now in
`.gitignore`, so the next copy of a working `.env` cannot be committed by the
same route.

---

## Part 3 — Environment topology

Three tiers, which is the minimum that satisfies "production is untouchable".

| | Development | Staging | Production |
|---|---|---|---|
| Branch | feature branches | `staging` | `master` |
| Frontend | local `ng serve` | Vercel preview / staging project | Vercel production |
| API | local uvicorn | Render service (free/starter) | Render `gaadiiq-api` |
| Database | local Postgres | **separate Supabase project** | Supabase production |
| Redis | optional | separate instance | `gaadiiq-cache` |
| Payments | dev-mode, no keys | Razorpay **test** keys | Razorpay live keys |
| Data | seeded | synthetic only | real |
| `KYC_HASH_PEPPER` | dev value | **different value** | production secret |

Two rules that make the difference between a staging environment and a second
production:

1. **Staging is built by migrations, from empty.** If staging is ever restored
   from a production dump, it stops testing the migration path — which is the
   one thing it exists to test.
2. **Staging never holds real personal data.** No copied rows. A different
   pepper, so even a hash collision proves nothing.

---

## Part 4 — Release strategy

### Flow

```
feature branch → PR → CI green → merge to staging → staging deploy
              → soak + smoke → PR staging→master → production deploy → verify
```

### Migration discipline

Under the "no touching production" rule, migrations are the only sanctioned way
the production schema ever changes.

- **Forward-only.** No destructive migration ships in the same release as the
  code that stops using a column. Deprecate first, drop a release later.
- **Expand / contract.** Add the new column, deploy code that writes both,
  backfill, deploy code that reads new, drop old — four releases, not one.
- Every migration runs on staging first, against a database built the same way
  production's was.
- CI already diffs the migration chain against the models on Postgres. Keep
  that gate mandatory.

### Rollback

Vercel and Render both roll back to a previous deploy in one click — that
covers code. **Schema does not roll back**, which is why expand/contract above
is not optional: a release must be safe to revert with the new schema still in
place.

### Go / no-go checklist

Run against the **running production service**, not the blueprint:

- [ ] `ENVIRONMENT=production` confirmed live (G6) — admin endpoints reject an
      unauthenticated request
- [ ] Redis reachable; limiter reports Redis storage, not memory fallback (G2)
- [ ] `default_limits` in force; a scripted burst against an *undecorated*
      endpoint gets 429 (G1)
- [ ] Cloudflare in front; origin refuses direct traffic (G3)
- [ ] Razorpay **live** keys set; `/verify` rejects a tampered signature; a
      replayed webhook returns `already_paid`
- [ ] `KYC_HASH_PEPPER` is the production value and differs from staging
- [ ] APITube key rotated (exposed in a screenshot — still outstanding)
- [ ] Google Maps key restricted to Maps JavaScript API + referrer allowlist
- [ ] `OCM_API_KEY` set, or the EV page's notice is accurate about its absence
- [ ] All `supabase/migrations/*.sql` applied, including `013`
- [ ] Backups: confirm Supabase PITR is on and test a restore **into staging**
- [ ] `.env.backup` deleted from the repo (G10)

### Verification after deploy

The checklist above is the deploy gate. Afterwards, the standing rule from
`CLAUDE.md` applies: a green build and a green suite do not tell you a page
works. Open the app and scroll it.

---

## Part 5 — Financial security for paying users

The code is in good shape here (Part 1). What remains is operational:

- **PCI scope.** Razorpay Checkout keeps card data off our servers entirely.
  Do not accept raw card details into our own forms — that changes our PCI
  obligations completely.
- **The webhook is the source of truth**, not the browser callback. A client
  that closes the tab mid-payment still gets credited by the webhook. Both
  paths are already verified and idempotent.
- **Refunds** (`/refund`) must be admin-only and audit-logged — see G9.
- **Reconciliation.** Nothing currently compares our `payments` table against
  Razorpay's settlement report. A daily reconciliation job that flags
  discrepancies is how you find out about a problem before the user does.
- **Amounts are integers in paise** already — no floats in the money path.

---

## Sequence

Nothing here is code-heavy; most of it is configuration and process.

**Done (this change):** G1 default rate limits, plus the middleware that makes
them real · G5 CI dependency scanning, plus the two upgrades it surfaced on the
JWT and upload paths · G10 `.env.backup` · G2 in part.

**Before any production release:** G3 Cloudflare · G6 environment assertion,
shipped warn-only first · a rehearsal of both, whether that is G4 staging or the
local-Postgres route already documented in `docs/STAGING.md`.

**Next release:** G8 migration runner · G9 audit log · G7 review write path ·
the `starlette` upgrade · the 12 shipped npm highs · reconciliation job.

The first four are the ones that would be expensive to retrofit once production
is frozen. The rest can follow the normal release train.
