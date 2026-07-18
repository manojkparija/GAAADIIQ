# Used Cars — Full Scenario Retest (2026-07-18)

**Surface:** Angular `/used-cars` (matches screenshot) + API `listing_type=used` (Next)  
**Workbook:** `docs/qa/GAADIIQ_UsedCars_Test_Results.xlsx`  
**Raw JSON:** `/opt/cursor/artifacts/used-cars/used-cars-scenarios.json`  
**Script:** `docs/qa/e2e_used_cars_scenarios.py`

## Verdict

**Filter logic works when data + clean search exist, but the live screenshot path is broken:** MODEL stuck on **RITZ**, badge shows **0+**, results **0**, while marketing claims **50,000+**. Users do not get the car list matching “All India / Any Budget”.

| Suite | Result |
|---|---|
| Scenario matrix | **31 PASS / 3 FAIL** (34) |
| API used create/filter | **4/4 PASS** |
| Product scorecard | See Excel (multiple FAIL on search UX / empty state) |

---

## Screenshot root cause

1. **MODEL = RITZ** (free-text input; browser autocomplete) + Make = All → filter matches nothing → **0 used cars found**  
2. Hero badge uses **`totalCount()` = filtered length** → **0+ Used Cars Available**  
3. Banner still says **50,000+ listed cars** (hardcoded)  
4. Possible empty Supabase used inventory (Angular used = `km>0 || year<2025 || isSellerListing`)

---

## What passed

- Route `/used-cars` + navbar  
- Used definition excludes brand-new (`km=0 && year≥2025`)  
- KM / fuel / certified / owner filter logic  
- Wishlist + recently viewed (localStorage)  
- View Details → `/cars/:id`, EMI link  
- My Journey query params (fuel/body/maxBudget)  
- API: create + filter `listing_type=used` + city + make  
- Next entry: `/listings?listing_type=used` (seed has 15 used)

---

## Gaps for Claude (priority)

### P0
1. Clear/disable model autocomplete; cascading Make→Model; Clear Search  
2. Hero badge = **unfiltered** used inventory count  
3. Seed/ensure Supabase used cars; honest empty state  
4. Fix placeholder → `assets/cars/placeholder.svg`  
5. Remove or replace hardcoded **50,000+**

### P1
6. Prefill city from navbar `CityService`  
7. Any Budget ≠ ₹50L cap  
8. Extend year range past 2025  
9. `clearAllFilters` reset `heroBudgetMax`  
10. Shareable `?make&model&city` URL sync  
11. Real AI valuation or relabel “AI-Verified”  
12. Align used definition with listings Used tab  

### P2
13. Playwright e2e for `/used-cars`

---

## Claude fix prompt (copy-paste)

```text
Fix GAADIIQ Angular Used Cars module (/used-cars) so users get the car list matching their request.
Read: docs/qa/UsedCars-E2E-Gaps.md and docs/qa/GAADIIQ_UsedCars_Test_Results.xlsx.

Screenshot bugs: badge "0+ Used Cars Available", MODEL=RITZ with Make=All, "0 used cars found", while banner claims "50,000+".

P0 — must fix:
1. SEARCH DEFAULTS — Stop empty-state from browser autocomplete. autocomplete="off" on model input; cascading Make→Model (reset model when make changes); Clear Search button that clears heroMake/heroModel/heroCity and budget.
2. HERO BADGE — Show UNFILTERED used inventory count in hero badge. Keep filtered count only in "X used cars found".
3. DATA — Ensure Supabase/demo has used cars (km>0 OR year<2025 OR is_seller_listing). If empty, show honest empty state ("No used cars listed yet") not "0+ Available" + fake 50,000+.
4. IMAGES — Replace assets/placeholder.svg → assets/cars/placeholder.svg on cards + recently viewed.
5. MARKETING — Replace hardcoded 50,000+ with live used count (or remove).

P1:
6. Prefill heroCity from CityService (navbar Kolkata).
7. Any Budget: no max (or ≥2Cr), not 50L cap.
8. yearTo through current year (+1); include in yearOptions.
9. clearAllFilters also resets heroBudgetMax.
10. Support query params make/model/city/minBudget; sync URL on search.
11. Relabel AI price verdict or wire ai_valuation.
12. Share isUsedCar helper with listings Used tab.

P2: Playwright e2e for /used-cars (load → clear → count>0 when seeded; city + budget filters).

Acceptance:
- Fresh /used-cars with no sticky filters shows used inventory count >0 when data exists (not 0+).
- MODEL empty by default; selecting Make filters models; RITZ alone cannot stick from autocomplete.
- Clear All restores full used list.
- City from navbar applies when set.
- No broken placeholder path; no false 50,000+ when count is 0.
```
