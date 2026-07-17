# List Your Car — E2E Retest & Gaps (2026-07-17)

**Surfaces tested**
- Angular: `/list-car` (matches user screenshot brand / wizard UX)
- Next.js: `/dashboard/listings/new` (production web seller path)
- API: register → create car → create listing → upload image → valuate → public feed / me

**Method**
- Code walkthrough of Angular `list-car` + Next `CreateListingForm`
- API journey script (`docs/qa/e2e_list_car_api.py`) — ASGI in-memory
- Listing unit suite: `tests/test_listings.py` → **11/11 PASS**
- Live Next probe: `/dashboard/listings/new` → **307 redirect to `/login`** (auth gate OK)
- Home CTA “List Your Car Free” → **`/register`** (not listing wizard)

---

## API journey results

| Step | Result |
|---|---|
| Register | 201 |
| Create car | 201 |
| Create listing | 201 (live, `image_urls=[]`, `ai_valuation=null`) |
| Public feed | visible (total=1) |
| `GET /listings/me` | 1 item |
| `POST /listings/{id}/images` | 200 (API works; UI missing) |
| `POST /valuate` (heuristic) | 200 |
| Unauth create (no cookie/token) | **401** (OK) |

---

## Critical gaps (P0)

### 1. Photos step missing / not wired
- User screenshot shows **Step 2: Photos** in a 4-step wizard.
- **Angular repo:** only **3 steps** — Car Details → Condition & Price → Your Info. **No photo upload UI.**
- **Next.js:** 2-step form; **never calls** `POST /listings/{id}/images` even though API + tests exist.
- Listings publish with **zero images** (confirmed in API E2E).

### 2. “AI-powered valuation” is marketing-only on submit
- Angular copy: “AI-powered valuation” / “AI valuation included”.
- Submit path **never calls** valuation; Next publish also skips it.
- Valuation only happens later via listing-detail button (Next).

### 3. Angular submit is fragile / can fake success
- Inserts into Supabase `cars` **without checking errors**; still sets `submitted=true` and shows success.
- Also writes to **localStorage** (`MyListingsService`) — dual source of truth.
- `description` is collected in the form but **not written** to Supabase insert.
- Success copy promises “verify within 2 hours” + “Free RC verification” — **no verification workflow** exists.

### 4. Broken / inconsistent entry points (Next)
- Home “List Your Car Free” → `/register` (not create-listing).
- Footer “List Your Car” → `/register`.
- Brand empty-state CTA → **`/listings/new`** (route **does not exist**; real path is `/dashboard/listings/new`).

### 5. No E2E UI test for List Your Car
- Playwright covers public pages + auth smoke only.
- **Zero** e2e covering Angular `/list-car` or Next create-listing wizard.

---

## High gaps (P1)

| # | Gap | Detail |
|---|---|---|
| 6 | Cascading make → model → variant | Screenshot shows model/variant dropdowns; Angular uses free-text model/variant; Next uses free-text make/model — no catalogue API binding |
| 7 | Year default = current calendar year | Defaults to e.g. 2026; awkward for used cars; no “new vs used” year rules |
| 8 | Weak step validation | Angular step1 only requires make/model/fuel; transmission/body/year optional for continue; phone not format-validated |
| 9 | Auth roles | Angular `/list-car` uses `authGuard` only (any logged-in user); `sellerGuard` not applied. Next: any registered user can create cars/listings |
| 10 | Orphan cars (Next) | Step1 `POST /cars` commits before listing; abandoning step2 leaves orphan car rows |
| 11 | No draft / resume | Wizard state lost on refresh; no draft listing status |
| 12 | City not tied to navbar city | Screenshot shows Kolkata in nav; form city is free text, not prefilled from city selector |
| 13 | Immediate public publish | API sets `is_active=true` with no moderation queue despite “pending verification” UX copy |
| 14 | Image requirements | No min photo count, no cover photo, no client compression guidance (API has type/size checks only) |

---

## Medium gaps (P2)

| # | Gap |
|---|---|
| 15 | Stepper UI crowding (“Photos” / “Condition & Price” labels) |
| 16 | Angular emoji section titles vs premium brand direction |
| 17 | Next form missing color field (Angular has it) |
| 18 | Angular missing condition enum / registration fields (Next has them) |
| 19 | No progress save analytics / funnel events |
| 20 | No post-publish boost / AI valuation CTA on success screen |
| 21 | Dual frontends (Angular list-car vs Next dashboard) will diverge further |

---

## Recommended Claude implementation order

```text
P0
1. Add Photos step (Angular + Next) calling POST /listings/{id}/images; block publish if <3 photos.
2. On publish, call /valuate (or queue it) and show result on success screen; stop claiming AI if skipped.
3. Fix Angular onSubmit: handle Supabase errors; persist description; don’t show success on failure.
4. Fix Next links: /listings/new → /dashboard/listings/new; home CTA → create flow after auth.
5. Add Playwright e2e: login → create listing → upload image → appears in /listings/me + public detail.

P1
6. Cascading brand/model/variant from cars catalogue API.
7. Prefill city from selected city; validate phone (+91).
8. Draft listings + moderation status (pending → live) matching success copy.
9. Atomic create (car+listing) or cleanup orphan cars.
10. Apply seller role gate consistently.

P2
11. Unify Angular list-car UX into Next wizard (single seller path).
12. Post-publish: boost, share, AI price tip.
```

---

## Verdict

**API core path works** (create + optional image upload + valuation).  
**Seller UX is not end-to-end complete:** photos and AI valuation are advertised but not executed in the wizard; Angular can report success without a durable listing; Next entry links are wrong/incomplete; no UI e2e coverage for the happy path.
