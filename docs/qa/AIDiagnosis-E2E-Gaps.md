# AI Diagnosis / AI Valuation — Full Feature Retest (2026-07-20)

**Scope note:** There is **no mechanical/OBD “AI Diagnosis”** module in the repo (no symptom wizard, DTC codes, or vehicle-health API).  
The closest implemented feature is **AI Valuation (price diagnosis)**. This retest covers that end-to-end.

**Workbook:** `docs/qa/GAADIIQ_AIDiagnosis_Test_Results.xlsx`  
**Raw JSON:** `docs/qa/ai-diagnosis-scenarios.json`  
**Script:** `docs/qa/e2e_ai_diagnosis_scenarios.py`

## Verdict

**Price valuation formulas work, but the product over-claims “AI” and is fragmented.** Angular silently falls back to a local formula when Claude fails; API uses a different Ollama/heuristic path that values from the asking price; Home misroutes “AI Price Valuation” to AI Advisor; hero copy says “no sign-up” while `authGuard` blocks the page.

| Suite | Result |
|---|---|
| Scenario matrix | **31 PASS / 22 FAIL / 1 PARTIAL** (54) |
| API `test_heuristic_*` | **5/5 PASS** |
| API endpoint `/valuate` pytest | **Blocked in this env** (passlib/bcrypt mismatch — not a product finding) |

---

## Surfaces tested

| Surface | Path | Engine |
|---|---|---|
| Angular standalone | `/ai-valuation` | Supabase Edge `ai-valuation` (Claude) → client `fallbackValuation` |
| List Your Car | wizard step | Same Edge + different `ruleBasedValuation` |
| Next listing detail | `ValuationButton` | `POST /listings/{id}/valuate` (Ollama → heuristic) |
| API | `services/valuation.py` | Ollama + depreciation heuristic |
| Car detail (Angular) | stored `ai_valuation` row | Display only |

---

## What passed

- Catalogue cascading Make → Model → Variant
- Fallback scoring: EV premium, condition/owner penalties, ±10% range, high-mileage tips logic
- List-car invokes Edge with 8s timeout then rule fallback
- API heuristic unit behaviors (age, mileage, EV, floor)
- Next ValuationButton auth gate + compare column
- Edge function present with Anthropic prompt

---

## Gaps for Claude (priority)

### P0
1. **No mechanical AI Diagnosis** — implement or stop calling it out in product language  
2. **Auth vs copy** — hero “no sign-up” vs `authGuard` on `/ai-valuation`  
3. **Silent AI fallback** — show “Estimated with market formula (AI unavailable)”  
4. **Unify engines** — one schema (`low/mid/high` + method) shared by Edge, API, List-car, Next  
5. **Circular API heuristic** — don’t derive fair value from asking price  
6. **List-car vs page fallback diverge** — same inputs must match  
7. **Home card** — “AI Price Valuation” → `/ai-valuation` (not `/ai-advisor`)  
8. **Rate-limit Edge** — Claude cost / abuse protection  

### P1
9. Persist/expose `method`, `confidence`, `reasoning` (and range) on API + Next UI  
10. Use `condition` + `transmission` in scoring  
11. Fix `ApiService.getAIValuation` → `POST /listings/{id}/valuate`  
12. Deterministic confidence (no `Math.random()`)  
13. Edge JSON parse: strip markdown fences  
14. Next standalone valuation page  
15. Honest marketing (remove fake “50,000+” / “actual sale prices” unless wired)  

### P2
16. SEO `setPage` on valuation  
17. Playwright e2e for `/ai-valuation`  

---

## Claude fix prompt (copy-paste)

```text
Fix GAADIIQ “AI Diagnosis” / AI Valuation so price estimates are trustworthy and honestly labeled.
Read: docs/qa/AIDiagnosis-E2E-Gaps.md and docs/qa/GAADIIQ_AIDiagnosis_Test_Results.xlsx.

IMPORTANT SCOPE:
- There is NO mechanical/OBD AI Diagnosis module. Do NOT pretend it exists.
- Closest feature is AI Valuation (price diagnosis) across:
  - Angular /ai-valuation (apps/gaadiiq-angular/src/app/pages/ai-valuation/*)
  - List Your Car valuation (list-car.component.ts)
  - Supabase Edge supabase/functions/ai-valuation/index.ts (Claude)
  - API POST /listings/{id}/valuate + services/valuation.py (Ollama + heuristic)
  - Next ValuationButton (apps/web/components/valuation-button.tsx)

P0 — must fix:
1. AUTH/COPY — Either remove authGuard from /ai-valuation OR change hero copy (remove “no sign-up needed”). Prefer: allow anonymous valuation; gate List My Car CTA behind auth.
2. HONEST FALLBACK — When Edge/Claude or Ollama fails, show a clear banner: “AI unavailable — showing formula estimate”. Never claim “AI-powered” / “actual sale prices” for pure fallback.
3. ONE ENGINE CONTRACT — Define a shared ValuationResult: {low, mid, high, confidence, depreciation, marketTrend, tips[], method: 'claude'|'ollama'|'heuristic'}. Make Angular page, List-car, Edge, and API all conform. Next UI must show mid + range + method badge.
4. STOP CIRCULAR HEURISTIC — API _heuristic_valuation must NOT use listing.price as the market base. Use catalogue/ex-showroom base (reuse Angular CATALOGUE or a server-side price table) then apply dep/km/owner/condition/fuel.
5. ALIGN FALLBACKS — Extract one shared TypeScript (or API) scorer used by both /ai-valuation and List Your Car so identical inputs produce identical mid.
6. HOME ROUTE — Change home “AI Price Valuation” card from /ai-advisor → /ai-valuation.
7. RATE LIMIT — Edge function: require auth or anon rate limit; reject abusive bursts.

P1:
8. Persist method/confidence/reasoning (and low/high if possible) on listings; ValuationButton shows them.
9. Score condition + transmission (both surfaces).
10. Fix ApiService.getAIValuation to call POST /listings/{id}/valuate (or remove dead helper).
11. Replace Math.random() confidence with deterministic score (variant known → 90, model known → 82, else 75).
12. Edge: strip ```json fences before JSON.parse.
13. Next: add /valuate (or /ai-valuation) standalone page mirroring Angular form → results.
14. Marketing: remove hardcoded “50,000+ valuations” / “Based on actual sale prices” unless backed by data.

P2:
15. SeoService.setPage on Angular valuation.
16. Playwright: logged-out or logged-in /ai-valuation → fill Swift → result shows mid>0; force Edge failure → fallback banner visible.

Acceptance:
- /ai-valuation accessible per chosen auth policy; copy matches policy.
- Forced Claude/Ollama failure shows heuristic banner (not silent AI claim).
- Same Swift 2022 35k km inputs on page and List-car produce same mid (±₹1k).
- API heuristic for a ₹12L ask with ₹8L catalogue base does NOT return ~ask×(1-dep).
- Home Price Valuation navigates to /ai-valuation.
- Next listing valuation shows method badge + at least mid (ideally low/high).
```

---

## How to re-run

```bash
python3 docs/qa/e2e_ai_diagnosis_scenarios.py
cd apps/api && PYTHONPATH=. python3 -m pytest tests/test_valuation.py -k 'test_heuristic_' -q
# Excel regenerated alongside this doc in the PR commit
```
