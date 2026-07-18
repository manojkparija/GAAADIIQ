# New Cars Module — Fixes + Revalidation (2026-07-18)

**Branch:** `cursor/fix-new-cars-module-85e1`  
**Revalidate script:** `docs/qa/revalidate_new_cars.py` → **22/22 PASS**

## What was fixed

| Issue (user report / prior FAIL) | Fix |
|---|---|
| **Above ₹30L** showed Max ₹1 Cr / all 55 models | Budget chips apply **min+max on-page**; Above = `minPrice≥30L`, open max; sidebar label shows “Above ₹30L”; results count updates |
| Electric / Luxury body filters empty | Electric → fuel=Electric; Luxury → min≥30L |
| Broken aeplcdn images | Removed hotlinks; use `assets/cars/placeholder.svg` / Swift local assets |
| Wrong placeholder path | All fallbacks → `assets/cars/placeholder.svg` |
| View Details ignored `model` | Listings reads `make`+`model` and opens variants |
| Compare heart unwired | sessionStorage + `/compare?keys=` prefills slots |
| Notify Me lost on refresh | Persisted per-user in localStorage; login required |
| ₹30L–₹30L display | Shows `₹X.XL onwards` when min===max |
| “Last 3 months” false | Copy + filter = last **12 months** |
| Expert CTA make-only | Passes make+model; labeled **Editorial** |

## Revalidation summary

```
SUMMARY: 22/22 PASS, 0 FAIL
```

Key cases:
- RV-001 Above ₹30L → only 30L+ new cars  
- RV-004 Budget bands exact  
- RV-005 Electric → EV only  
- RV-006 Luxury → min≥30L  
- RV-007 Used excluded  
- RV-010–022 wiring/static checks  

## Files changed

- `apps/gaadiiq-angular/src/app/pages/new-cars/new-cars.component.{ts,html,scss}`
- `apps/gaadiiq-angular/src/app/pages/listings/listings.component.{ts,html}`
- `apps/gaadiiq-angular/src/app/pages/compare/compare.component.ts`
- `apps/gaadiiq-angular/src/app/services/cars-data.service.ts`
- `docs/qa/revalidate_new_cars.py`
- `docs/qa/NewCars-Revalidation-Results.md`

## How to verify in UI

1. Open `/new-cars`
2. Click **Above ₹30L** → Popular Models filter shows “Above ₹30L”, count drops to luxury-priced models only  
3. Click **Electric** → only EVs  
4. Click **View Details** on a model → listings variant view for that model  
5. Heart + **Compare now** → compare prefilled  
6. **Notify Me** (logged in) → survives refresh  
