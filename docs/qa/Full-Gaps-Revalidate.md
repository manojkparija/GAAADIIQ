# Full Gaps Revalidation

**When:** 2026-07-20T16:48:50.535381+00:00
**Code:** `claude/gaadiiq-app-dev-abj5fo @ 1bfa91d`

## Summary: **36 PASS / 14 FAIL** (50 total)

### Module rollup

- **Used Inventory**: 2 PASS / 0 FAIL
- **Used Cars P0**: 8 PASS / 0 FAIL
- **Used Cars P1**: 3 PASS / 0 FAIL
- **Used Cars Remaining**: 0 PASS / 4 FAIL
- **Used Filter Scenarios**: 8 PASS / 0 FAIL
- **Diagnosis Existence**: 3 PASS / 0 FAIL
- **Diagnosis Gaps**: 5 PASS / 2 FAIL
- **Valuation Gaps**: 4 PASS / 1 FAIL
- **New Cars Gaps**: 2 PASS / 3 FAIL
- **Advisor Spot**: 1 PASS / 4 FAIL

## Remaining FAILs

| ID | Suite | Severity | Gap |
|---|---|---|---|
| UC-REM-01 | Used Cars Remaining | P2 | All-India soft banner visible after auto-override — showAllIndiaBanner requires !allIndiaOverride — banner hidden exactly when override activates (auto empty-city path) |
| UC-REM-02 | Used Cars Remaining | P2 | Empty state links to AI Advisor — No Advisor CTA in used-cars empty state |
| UC-REM-03 | Used Cars Remaining | P2 | Filter state written back to URL — Reads queryParams on init; no navigate write-back of filters |
| UC-REM-04 | Used Cars Remaining | P2 | Playwright e2e covers /used-cars — e2e specs=3; used-cars mentioned=False |
| DG-01b | Diagnosis Gaps | P1 | Photos uploaded to storage (not filenames only) — image_urls currently map(f => f.name) — filenames only, not hosted URLs |
| DG-03 | Diagnosis Gaps | P2 | History UI on Angular — API history endpoint exists=True; Angular history UI=False |
| VR-05 | Valuation Gaps | P2 | Playwright e2e for diagnosis/valuation — No dedicated e2e for diagnosis/valuation routes |
| NC-01 | New Cars Gaps | P0 | Above ₹30L uses open max (null) not 1 Cr cap — budgetRanges Above ₹30L max=100000000 — fix lives on cursor/fix-new-cars-module-85e1, NOT on Claude tip |
| NC-02 | New Cars Gaps | P0 | Budget chips filter on-page (fix-branch behavior) — applyBudget=False; navigateToBudget=True; budgetFilterLabel=False |
| NC-05 | New Cars Gaps | P0 | New Cars fix commit merged into Claude tip — cursor/fix-new-cars-module-85e1 (dbf9026) is NOT an ancestor of claude/gaadiiq-app-dev-abj5fo |
| AD-01 | Advisor Spot | P1 | Angular advisor wired to POST /recommend — Still client-side rule scoring; not calling API /recommend |
| AD-02 | Advisor Spot | P2 | LLM / ai-chat in Angular advisor — No LLM chat path in ai-advisor.component.ts |
| AD-04 | Advisor Spot | P2 | Playwright e2e for /ai-advisor — No dedicated Angular advisor e2e |
| AD-05 | Advisor Spot | P1 | Single unified advisor experience (Angular + Next) — Angular multi-step quiz vs Next recommend flow remain divergent (no unification commit on tip) |

## Verdict by prior P0/P1

### Used Cars (screenshot: New Town / Year 2005)
- **FIXED:** New Town→Kolkata alias, year select defaults, Clear All clears CityService, city/year chips, empty-city All India override + CTA.
- **REMAINING:** soft banner hidden after auto-override (UC-REM-01), no Advisor empty CTA, no URL write-back, no Playwright.

### AI Diagnosis / Valuation
- **FIXED:** Next `/diagnosis` + `/valuation` pages, Angular photo picker, ApiService `valuateListing` path, session `user_id`.
- **REMAINING:** photos are filenames only (no storage upload), no history UI, no Playwright e2e.

### New Cars
- **NOT on Claude tip** — `cursor/fix-new-cars-module-85e1` (Above ₹30L / Electric / Compare / Notify) is a separate PR branch and is not merged into `claude/gaadiiq-app-dev-abj5fo`.
- Claude tip still has `Above ₹30L` with `max: 100000000` and lacks `applyBudget` on-page filtering from the fix branch.

### AI Advisor
- **Not fixed on tip** — still client-side scoring, not wired to `/recommend`, no LLM, divergent Next/Angular.
