# Used Cars — Screenshot Retest + Scenario Matrix (2026-07-20)

**Surface:** Angular `/used-cars`  
**Workbook:** `docs/qa/GAADIIQ_UsedCars_Revalidate.xlsx`  
**JSON:** `docs/qa/used-cars-revalidate.json`  
**Script:** `docs/qa/e2e_used_cars_revalidate.py`

## Verdict

**Filter engine works, but city prefill + year dropdown UX create a false "0 used cars" experience.** Screenshot matches: navbar city **New Town** (0 inventory) → **Clear All (1)** → empty state; Year select **looks like 2005–2005** because `yearTo = currentYear+1` is not in `yearOptions`.

| Suite | Result |
|---|---|
| Scenario matrix | **30 PASS / 17 FAIL** (47) |

---

## Screenshot root cause

1. **Primary — City = New Town:** `ngOnInit` sets `heroCity` from `CityService.selectedCity()`. Geolocation/Nominatim can return suburb **"New Town"** (not in seed). Filter requires city substring match → **0 used cars**. `activeFiltersCount` = 1 (city only) → **"Clear All (1)"**.
2. **Secondary — Year UI 2005:** `yearTo` defaults to `currentYear + 1` (e.g. 2027) but `yearOptions` only goes to `currentYear` (2026). `<select [value]="yearTo()">` fails to match → browser shows **first option 2005**. Confusing but filter may still use 2027 unless user changes it.
3. **Clear All incomplete:** resets `heroCity` but **not** navbar `CityService` → leaving and returning re-applies New Town → empty again.
4. **Filter strip incomplete:** no chip for city/year — user cannot see why count is 0.

Seed: **0** cars in New Town; **0** cars from year 2005; ~29 used cars exist nationally.

---

## What passed

- Default filters (no city) return used inventory  
- Kolkata / Maruti / Swift / budget / diesel / KM / SUV filters  
- Empty state UI + Clear All Filters button  
- Unfiltered `usedCarCount` hero badge  
- `autocomplete="off"` on model  
- Wishlist / recently viewed / query-param read  

---

## Gaps for Claude (priority)

### P0
1. Stop auto-hard-filtering All India by navbar city when that city has 0 used stock (or default to All India with optional "Near you" chip)
2. `clearAllFilters` → also `cityService.clearCity()` (or "All India" mode that ignores navbar until re-applied)
3. Fix year options: include `currentYear+1` OR set `yearTo = currentYear`; use proper selected binding
4. Show active chips for **city** and **year range**
5. Empty state: "No used cars in {city}" + **"Show All India"** primary CTA

### P1
6. Normalize city aliases (Bengaluru↔Bangalore, New Town→Kolkata metro)
7. Geolocation: map Nominatim result to nearest `POPULAR_CITIES`
8. Relabel or wire "AI-Verified" pricing
9. Playwright e2e for screenshot path

### P2
10. Sync filters to URL  
11. Optional AI Advisor CTA on empty  

---

## Claude fix prompt (copy-paste)

```text
Fix GAADIIQ Angular Used Cars (/used-cars) false-empty state from the screenshot.
Read: docs/qa/UsedCars-Revalidate.md and docs/qa/GAADIIQ_UsedCars_Revalidate.xlsx.

Screenshot: "0 used cars found", Year shows 2005 to 2005, Clear All (1), navbar city "New Town", empty card "No cars match your filters".

Root cause:
1. ngOnInit prefills heroCity from CityService — geolocation can set "New Town" (Nominatim town) with 0 seed/listings → filtered count 0 and activeFiltersCount=1.
2. yearTo = currentYear+1 but yearOptions only go to currentYear → select [value] mismatch displays first option 2005.
3. clearAllFilters clears heroCity but not CityService — revisit re-applies city.
4. Active filter strip has no chip for city/year.

P0 — must fix:
1. CITY DEFAULT — On /used-cars load: if selected city has 0 used cars, do NOT apply heroCity filter (stay All India) and show a soft banner: "No used cars in {city} yet — showing All India. [Filter to {city}]".
2. CLEAR ALL — clearAllFilters() must call CityService.clearCity() OR set an explicit allIndia=true that ignores navbar city until user picks a city again on this page.
3. YEAR SELECT — Either add currentYear+1 to yearOptions, or set yearTo default to currentYear. Bind selects with [selected]="y === yearFrom()" (or ngModel) so UI matches signals — never flash 2005 incorrectly.
4. FILTER CHIPS — Always show chips for heroCity (if set), yearFrom/yearTo when not defaults, so Clear All (N) is explainable.
5. EMPTY STATE — If heroCity set and count=0: title "No used cars in {city}", primary button "Show All India cars", secondary "Clear All Filters".

P1:
6. City alias map: Bengaluru→Bangalore, New Town/Salt Lake→Kolkata, Navi Mumbai→Mumbai (or include in match).
7. Geolocation: after Nominatim, snap to nearest POPULAR_CITIES by name/contains before setCity.
8. Relabel "AI-Verified" or use stored aiValuation.
9. Playwright: set city New Town → expect empty with Show All India → click → count>0; year dropdown displays yearTo not 2005.

P2: URL sync for city/make/model/year; optional AI Advisor link on empty.

Acceptance:
- With navbar city New Town and seed data, /used-cars shows All India used cars (or explicit empty with one-click All India) — not a mysterious 0 with Year looking like 2005.
- Year dropdowns visually match yearFrom/yearTo signals.
- Clear All prevents New Town from immediately re-filtering on next visit (or documents All India mode).
- Active filter chips include City when filtering by city.
```
