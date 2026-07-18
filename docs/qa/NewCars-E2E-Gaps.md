# GAADIIQ New Cars — Full Scenario Retest (2026-07-18)

**Workbook:** `docs/qa/GAADIIQ_NewCars_Test_Results.xlsx`  
**Screenshots:** `/opt/cursor/artifacts/new-cars/`  
**API script:** `docs/qa/e2e_new_cars_api.py`  
**UI spec:** `apps/web/tests/e2e/new-cars.spec.ts`

## Verdict

**New Cars is partially wired, not product-complete.**  
Listing filter `listing_type=new` works on the API and Next nav, but inventory is empty on seed, catalogue depth (brand→model→variant), dealers, on-road pricing, and Angular/API “new” semantics are inconsistent. **Not CarDekho-parity.**

| Suite | Result |
|---|---|
| API scenarios | **18 PASS / 1 FAIL** (19) |
| Next Playwright | **11/11 executed** (several assert known missing routes) |
| Product UI scorecard | **6 PASS · 4 PARTIAL · 5 FAIL** (see Excel UI sheet) |
| Angular `/new-cars` audit | Present hub; several cosmetic/static/broken wires |

---

## What works

- Navbar / homepage → `/listings?listing_type=new`
- API create + filter new by make / body / fuel / price / city
- Detail, similar, update, search, auth gate on create
- Next `/cars` brand directory + `/cars/[make]` page shell
- Angular `/new-cars` hub: brand/budget/body hero, filters, model cards, navigate to listings new mode
- Angular test-drive path exists (Supabase)

---

## Critical gaps for Claude (P0)

1. **Empty New Cars inventory** — `seed.py` only seeds `listing_type=used`. Fresh deploy → empty New Cars page.
2. **No km validation for new** — API accepts `listing_type=new` with `km_driven=25000` (NC-API-013 FAIL).
3. **Broken CTAs** — `/listings/new` → **404**; listing detail `/listings/[id]/book` → **404**.
4. **Dual “new” definitions** — Angular: `km===0 && year>=2025`; Next/API: `listing_type=new`.
5. **Missing PRD catalogue routes** — no `/cars/[brand]/[model]` or variant pages; `/dealers` missing.

## High gaps (P1)

6. Create-listing UI still shows KM/owners/condition for `new`.
7. No city on-road price tables (Angular heuristic only).
8. No Get Best Price / dealer leads / brochure / colour catalogue on Next.
9. Angular Compare heart + Notify Me do not persist / do not prefill compare.
10. `/cars` body-type links drop `listing_type=new`.
11. No dedicated Next `/new-cars` hub (launches/upcoming are Angular-hardcoded).
12. Brand page mixes new+used listings.

## Medium (P2)

13. EMI fake formula on Angular new listings (`price * 0.008`).
14. Compare max 3, no shareable URL, no new-car preselect.
15. Hardcoded launches/upcoming/expert picks (stale by design).
16. Keep New Cars regression suite in CI.

---

## Copy-paste prompt for Claude

```text
Fix GAADIIQ New Cars to be product-complete. Read docs/qa/NewCars-E2E-Gaps.md and docs/qa/GAADIIQ_NewCars_Test_Results.xlsx.

P0 must-do:
1. Seed ≥20 listing_type=new cars in apps/api/seed.py (varied makes/cities).
2. Validate listing_type=new ⇒ km_driven is 0 or null (API + hide KM/owners in create form when new).
3. Fix href /listings/new → /dashboard/listings/new; implement or remove /listings/[id]/book.
4. Unify Angular new definition with API listing_type (or map badge_type consistently).
5. Add Next catalogue routes /cars/[brand]/[model] (+ variant) with specs + starting price; add /dealers stub + Get Best Price lead.

P1:
6. On-road price by city/state tax tables.
7. Wire Angular compare selection + notify-me to real storage/API.
8. Preserve listing_type=new on body-type browse from New Cars.
9. Optional Next /new-cars hub parity with Angular (data-driven, not hardcoded).

Add/keep tests: docs/qa/e2e_new_cars_api.py and apps/web/tests/e2e/new-cars.spec.ts in CI.
```
