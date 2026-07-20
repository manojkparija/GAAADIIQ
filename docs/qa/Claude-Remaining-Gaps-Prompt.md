# Claude Fix Prompt — Remaining GAADIIQ Gaps (post 2026-07-20 revalidate)

## Context
Used Cars P0/P1 and Diagnosis/Valuation Next pages are largely fixed on `claude/gaadiiq-app-dev-abj5fo`.
Revalidation: see `docs/qa/Full-Gaps-Revalidate.md`.

## Fix these remaining items (priority order)

### P0 — Merge / re-apply New Cars fixes onto Claude tip
Branch `cursor/fix-new-cars-module-85e1` (commit dbf9026) is **not** merged into `claude/gaadiiq-app-dev-abj5fo`.
Cherry-pick or merge:
- Above ₹30L → min≥30L with open max (null), on-page `applyBudget`
- Electric → fuel filter; Luxury → min≥30L
- Compare sessionStorage prefill, Notify localStorage, placeholder.svg, 12-month launches copy

### P1 — Used Cars banner logic
File: `apps/gaadiiq-angular/src/app/pages/used-cars/used-cars.component.ts`
- `showAllIndiaBanner` currently requires `!allIndiaOverride()`.
- After ngOnInit sets `allIndiaOverride=true` for empty cities, the amber banner never shows.
- Change to: show banner when `allIndiaOverride() && heroCity()` (and optionally cityCarsCount===0).
- Keep "Filter to {city}" button wired to `filterToCity()`.

### P1 — Diagnosis photo upload is filenames-only
Files: Angular `vehicle-diagnosis.component.ts`, Next `apps/web/app/diagnosis/page.tsx`
- Today `image_urls` = `selectedImages().map(f => f.name)`.
- Upload images to Supabase Storage (or API multipart), then pass real public URLs in `image_urls`.
- Keep thumbnail previews.

### P1 — AI Advisor still divergent / not API-wired
- Angular `ai-advisor` uses local scoring; does not call `POST /recommend`.
- Next advisor/recommend flow differs (fewer steps, missing CNG/MPV parity).
- Wire Angular to API or document single source of truth; unify scoring.

### P2 — Diagnosis history UI
- API has `/diagnosis/history`; Angular has no history list for logged-in users.
- Add a simple "Past diagnoses" panel when `user_id` present.

### P2 — Empty-state Advisor CTA on Used Cars
- When 0 results, add secondary link to `/ai-advisor`.

### P2 — URL write-back for Used Cars filters
- Mirror active filters into query params on change (city, make, model, fuel, budget).

### P2 — Playwright coverage
- Add e2e for `/used-cars` (New Town alias → results), `/vehicle-diagnosis`, `/ai-valuation` or Next `/diagnosis`+`/valuation`.

## Do NOT regress
- New Town/Bengaluru aliases, Clear All → `CityService.clearCity()`, year defaults, All India override, Next diagnosis/valuation pages, `valuateListing` path.
