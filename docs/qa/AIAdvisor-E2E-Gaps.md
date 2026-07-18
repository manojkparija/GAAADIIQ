# AI Advisor — Full Feature Retest (2026-07-18)

**Primary surface (screenshot):** Angular `/ai-advisor` — 11-step quiz  
**Secondary:** Next.js `/recommend` (navbar “AI Advisor”) + API `POST /recommend`  
**Workbook:** `docs/qa/GAADIIQ_AIAdvisor_Test_Results.xlsx`  
**Raw JSON:** `docs/qa/ai-advisor-scenarios.json`, `docs/qa/api-recommend-smoke.json`  
**Scripts:** `docs/qa/e2e_ai_advisor_scenarios.py`, `docs/qa/api_recommend_smoke.py`

## Verdict

**The Angular quiz UX and client scoring work for common profiles (Brand New / Used / EV / family / CNG), but this is not a real AI Advisor.** Analyzing is a timed theater; several answers are ignored; Next.js still does `GET /listings` and drops `usage`; `POST /recommend/ai-chat` from the LLD does not exist; Angular and Next are two divergent products.

| Suite | Result |
|---|---|
| Scenario matrix (Angular logic + static + platform) | **30 PASS / 29 FAIL / 1 PARTIAL** (60) |
| API `POST /recommend` smoke | **5/5 PASS** |
| Product vs Vision/PRD (“conversational LLM”) | **FAIL** |

---

## What passed

### Angular `/ai-advisor`
- Route + 11 steps (12 when Electric → EV readiness step)
- Progress chip / bar / Back / Next / multi-select
- Scoring scenarios returning ranked cars with fuel hard-filter: Petrol hatch, Diesel SUV, Electric >₹30L, MUV family, off-road SUV, CNG, Compact SUV
- Results: match %, reasons, EMI / fuel / maint / 5yr TCO, pros/cons, Compare Top 3, Retake, View Details → `/cars/:id`
- Intentional hero gradient on “Advisor” (not a CSS bug)

### API
- `POST /recommend` rule-engine returns `match_score` + `reasons`
- Hard filters for budget / fuel / body; usage soft-scored
- Documented as non-LLM

### Next
- Page loads; budget → fuel step e2e exists
- Navbar links to `/recommend`

---

## Critical failures / gaps

### P0
1. **Marketing “AI” without AI** — `ANALYZE_MSGS` says “Running AI recommendation engine…”; scoring is local TypeScript rules on Supabase `cars`.
2. **Next ignores `POST /recommend`** — still `GET /listings?min_price&max_price&fuel_type&body_type`; no scores/reasons.
3. **Next drops `usage`** — collected then unused.
4. **Empty results UI missing** — impossible combo yields `results=[]` with no empty state.
5. **Budget leak (no fuel pref)** — Under ₹5L still surfaces ₹6–8L cars (`scored.slice(0,5)` with no hard budget cap). Seed has **0** cars ≤₹5L.
6. **Brand New / Certified Used heuristics** — `year >= currentYear-1 && km < 15000` ≠ marketplace `listing_type` / certified badge.
7. **No `POST /recommend/ai-chat`** — LLD/APIContracts promise SSE explanations.
8. **Dual advisors** — Angular 11-step vs Next 4-step; no shared engine.

### P1
9. Analytics `body_type` reads `p['body']` (undefined); key is `bodyType`.
10. `drivingMix` and `ev` answers never scored.
11. Best Family badge: `needSeating(p['familySize'] as string)` but value is `string[]` → always treats as 6+.
12. Results/compare images fall back to `placehold.co`.
13. Next sends `body=mpv`; API/DB enum is `muv` → **0 MPV results**.
14. Quiz state not persisted on nav away.
15. Angular not wired to API listings / `POST /recommend`.

### P2
16. SEO “10 questions” vs UI 11/12.
17. Hardcoded “Evaluating **58** vehicles” (seed ≈92).
18. Next missing CNG fuel option.
19. City (navbar Kolkata) unused.
20. No Playwright e2e for Angular `/ai-advisor`.
21. Home card “AI Price Valuation” routes to `/ai-advisor` (wrong feature).

---

## Scoring scenario highlights (seed SQL inventory)

| ID | Profile | Result |
|---|---|---|
| SC-01 | Brand New · ₹5–10L · Petrol · Hatch | PASS — top matches in-band |
| SC-02 | Certified Used · ₹10–15L · Diesel · SUV | PASS |
| SC-03 | Above ₹30L · Electric · SUV | PASS |
| SC-04 | Under ₹5L · no prefs | **FAIL — budget leak** (no ≤₹5L stock + soft ranking) |
| SC-05–08 | Family MUV / off-road / CNG / Compact SUV | PASS |
| SC-09 | Impossible combo → empty | PASS (logic) / UI empty-state FAIL (RS-01) |

---

## Claude fix prompt (copy-paste)

```text
Fix GAADIIQ AI Advisor so it matches product claims and returns trustworthy recommendations.
Read: docs/qa/AIAdvisor-E2E-Gaps.md and docs/qa/GAADIIQ_AIAdvisor_Test_Results.xlsx.

Surfaces:
- Angular (screenshot): /ai-advisor — apps/gaadiiq-angular/src/app/pages/ai-advisor/*
- Next navbar “AI Advisor”: /recommend — apps/web/app/recommend/page.tsx
- API rule-engine: POST /recommend — apps/api/routers/recommend.py
- LLD missing piece: POST /recommend/ai-chat (SSE) — docs/LLD/APIContracts.md

P0 — must fix:
1. NEXT WIRE-UP — Change fetchRecommendations to POST ${API_URL}/recommend with {budget, fuel, body, usage, page_size}. Render match_score + reasons. Stop using GET /listings for advisor results.
2. USAGE — Ensure usage is sent and affects ranking (API already soft-scores it).
3. HONEST AI UX — Either (a) call a real LLM explain endpoint, or (b) relabel analyzing copy to “Scoring listings…” and remove “AI recommendation engine” theater. Do not claim LLM if none.
4. EMPTY STATE — Angular results phase: if results().length===0 show “No matches — broaden fuel/budget/body” + Retake.
5. BUDGET HARD FILTER — When returning top N, never include cars > budgetMax*1.10 (including no-fuel-preference path). If zero in-band, show empty state (don’t backfill far over budget).
6. CONDITION ALIGNMENT — Brand New = listing_type new OR (km===0 && year>=currentYear); Certified Used = verified/certified used listings — not year>=cy-1 && km<15000 only.
7. MPV/MUV — Accept body=mpv as alias for muv in API; or change Next BODY_OPTIONS value to "muv".
8. AI-CHAT — Implement POST /recommend/ai-chat per LLD (or explicitly document deferred and remove from PRD checkboxes). Prefer streaming explanation grounded in scored cars.

P1:
9. Analytics: body_type from p['bodyType']?.[0].
10. Score drivingMix (city/highway efficiency) and ev readiness (penalize EV if public-only + high dailyKm).
11. Fix Best Family: needSeating((p['familySize'] as string[])?.[0] || '2 – 3 people').
12. Replace placehold.co with assets/cars/placeholder.svg.
13. Persist quiz profile+stepIdx in sessionStorage; restore on return.
14. Prefer one engine: Angular should call the same POST /recommend (or shared scorer) against live listings, not only local CarsDataService.

P2:
15. SEO/hero copy: use totalSteps() (“11” / “12”), dynamic vehicle count.
16. Add CNG to Next fuel options.
17. Optional city boost from CityService.
18. Playwright: /ai-advisor full happy path + empty path + compare.
19. Home: don’t link “AI Price Valuation” to /ai-advisor.

Acceptance:
- Next /recommend end-to-end shows scored recommendations with reasons; usage changes order/composition.
- Angular empty profile combo shows empty state (not blank cards).
- Under ₹5L with no stock ≤₹5L → empty (not ₹8L Swift).
- body=mpv returns MUV listings.
- No “Running AI…” copy unless a real model is invoked.
- Analytics body_type populated.
```

---

## How to re-run

```bash
python3 docs/qa/e2e_ai_advisor_scenarios.py
apps/api/.venv/bin/python docs/qa/api_recommend_smoke.py
python3 docs/qa/generate_ai_advisor_excel.py
```
