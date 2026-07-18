# New Cars — Full Feature E2E (Screenshot Sections) — 2026-07-18

**Scope:** Angular `/new-cars` features shown in user screenshots + downstream listings/compare/notify paths.  
**Workbook:** `docs/qa/GAADIIQ_NewCars_Full_E2E_Results.xlsx`  
**Scenario JSON:** `/opt/cursor/artifacts/new-cars/angular-e2e-scenarios.json`

## Verdict

**Sections render, but most E2E feature paths FAIL.**  
Broken hotlinked images + wrong placeholder path dominate UX. View Details, Compare, Notify Me, Above ₹30L budget, and Electric/Luxury body filters are miswired.

| Suite | Result |
|---|---|
| Angular feature scenarios | **9 PASS · 13 FAIL · 3 PARTIAL** (25) |
| API `listing_type=new` (prior) | 18 PASS · 1 FAIL |
| Next Playwright (prior) | 11/11 executed |

---

## Results by screenshot section

| Section | Status | Findings |
|---|---|---|
| Hero Brand / Budget / Body tabs | PASS | Navigate with `carType=New` |
| Browse by Body Type | PARTIAL | UI OK; Electric/Luxury not valid listings bodyTypes; icons wrong |
| Browse by Budget | FAIL | **Above ₹30L** uses `maxPrice=100000000` (almost all cars) |
| Popular New Car Models | FAIL | CDN images 404; fallback path missing; badge overlap; Compare unwired; View Details ignores `model` QP |
| New Launches | FAIL | Hotlink 404; “last 3 months” false; date truncation; Swift missing NEW |
| Upcoming + Notify Me | FAIL | Images broken; Notify is **in-memory only** |
| Expert Recommendations | FAIL | Hardcoded; View Model → make only; not AI |

---

## P0 gaps (Claude must fix)

1. **Images 404** — `imgd.aeplcdn.com` returns **404**; only local Swift assets work.  
2. **Wrong placeholder** — code falls back to `assets/placeholder.svg` which **does not exist** (correct: `assets/cars/placeholder.svg`).  
3. **View Details broken** — passes `model` query param; `listings.component` **never reads** `params['model']` (only `selectModel()` via in-page click).  
4. **Compare unwired** — heart `compareSet` unused; Compare button opens empty `/compare`.  
5. **Notify Me fake** — `toggleNotify` signal only; lost on refresh; no email.  
6. **Above ₹30L bug** — should be `minPrice >= 30L`, not max≈∞.  
7. **Electric / Luxury body** — not in listings `bodyTypes`; filters empty/wrong.

## P1 gaps

8. Launches date window / badge / pill truncation  
9. Expert & Launch CTAs make-only (no model)  
10. `₹30L – ₹30L` when min==max  
11. Card media box height when image missing  
12. Expert picks labeled as AI but hardcoded  

---

## Claude fix prompt (copy-paste)

```text
Fix ALL broken New Cars E2E features on Angular /new-cars.
Read: docs/qa/NewCars-Full-E2E-Gaps.md and docs/qa/GAADIIQ_NewCars_Full_E2E_Results.xlsx.

P0:
1. IMAGES — Stop hotlinking imgd.aeplcdn.com (404). Use assets/cars/* or R2. Change every fallback from assets/placeholder.svg → assets/cars/placeholder.svg. Fixed aspect-ratio image box so badges never overlap titles.
2. VIEW DETAILS — From Popular Models, open that model’s variants: either listings reads queryParams make+model and calls selectModel(), OR route to /cars/{{representativeId}}.
3. COMPARE — Persist compare-heart IDs and prefill /compare (queryParams or sessionStorage). Compare button must not open empty.
4. NOTIFY ME — Persist upcoming notifies (Supabase/API) for logged-in user email; survive refresh.
5. BUDGET — "Above ₹30L" ⇒ minPrice>=3000000 (add minPrice support on listings). Other chips keep maxPrice.
6. BODY TYPE — Electric ⇒ fuel=Electric; Luxury ⇒ minPrice (e.g. 30L+). Don’t send bodyType=Electric/Luxury into Hatchback/Sedan/SUV/MUV-only filter.

P1:
7. New Launches: fix “last 3 months” logic/copy; date pill CSS; NEW badge rules.
8. Expert/Launch CTAs: pass make+model; label Expert as Editorial unless AI-backed.
9. Price: if min===max show “₹X.XL onwards”.
10. Replace misleading body-type icons with vehicle SVGs.

Acceptance: no broken images (placeholder OK); View Details → correct model; Compare prefilled; Notify persists; Above ₹30L + Electric/Luxury filters correct; add tests for query-param wiring.
```
