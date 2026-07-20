# AI Diagnosis + Valuation — Revalidation (2026-07-20)

**Branch tested:** `claude/gaadiiq-app-dev-abj5fo` (work branch `cursor/ai-diagnosis-revalidate-85e1`)  
**Note:** These fixes are **not merged to `master` yet**.  
**Workbook:** `docs/qa/GAADIIQ_AIDiagnosis_Revalidate.xlsx`  
**Raw JSON:** `docs/qa/ai-diagnosis-revalidate.json`  
**Script:** `docs/qa/revalidate_ai_diagnosis.py`

## Verdict

**Most prior Valuation P0s are fixed, and Vehicle Diagnosis is newly implemented and working for keyword/client + API retrieval paths.** Remaining gaps are media upload, history UI, Next.js parity, a dead Angular API helper, and e2e coverage.

| Suite | Result |
|---|---|
| Full revalidation matrix | **51 PASS / 7 FAIL** (58) |
| API `test_heuristic_*` | **5/5 PASS** |

---

## What is now PASS (was FAIL before)

### Vehicle Diagnosis (new)
- `/vehicle-diagnosis` public route + navbar **AI Diagnosis**
- 4-step wizard, cascading make/model/variant, SEO, disclaimer
- Client exact-word fallback: overheat, brake, battery, transmission, AC, oil, CEL
- `heater ≠ overheat` false-positive fix
- Immediate client result + API upgrade path
- Server KB retrieval (12 cases) + Ollama/heuristic + persist + history API
- Service centre modal + Google Maps directions

### AI Valuation (prior gaps)
- `authGuard` removed from `/ai-valuation`
- Honest heuristic fallback banner + method badge
- Shared `valuation-engine.ts` (page + List Your Car)
- Deterministic confidence (no `Math.random()` usage)
- Home **AI Price Valuation** → `/ai-valuation`
- API catalogue-based heuristic (not circular ask price)
- Transmission modifier; `ai_method`/`confidence`/`reasoning` on ListingOut
- Next method badge; Edge rate limit + method field
- SEO `setPage`; marketing “50,000+” removed

---

## Remaining FAILs (for Claude)

| ID | Priority | Gap |
|---|---|---|
| DG-01 | P1 | No image/audio/video upload in Angular wizard (API already accepts URLs) |
| DG-03 | P2 | No Angular UI for `/diagnosis/history` |
| DG-04 | P1 | No Next.js `/vehicle-diagnosis` page |
| DG-05 | P2 | `user_id` not auto-attached → history empty for logged-in users |
| VR-01 | P1 | `ApiService.getAIValuation` still calls dead `GET /ai/valuation/{id}` |
| VR-02 | P1 | No Next standalone valuation tool page |
| VR-05 | P2 | No Playwright e2e for diagnosis/valuation |

Also: **merge `claude/gaadiiq-app-dev-abj5fo` → master** so production gets these fixes.

---

## Claude remaining-fix prompt (copy-paste)

```text
Revalidation found 51/58 PASS on branch claude/gaadiiq-app-dev-abj5fo for AI Diagnosis + Valuation.
Read: docs/qa/AIDiagnosis-Revalidate.md and docs/qa/GAADIIQ_AIDiagnosis_Revalidate.xlsx.

Do NOT re-fix already-passing P0 valuation items (auth removal, shared engine, honest fallback, catalogue heuristic, home route, rate limit) — they pass.

Finish remaining gaps:

P1:
1. MEDIA UPLOAD — In Angular /vehicle-diagnosis wizard, allow optional photo upload (max 5). Upload to existing storage (Cloudinary/Supabase) and send image_urls to POST /diagnosis/analyse. Show thumbnails on confirm step.
2. NEXT DIAGNOSIS PAGE — Add apps/web/app/vehicle-diagnosis (or /diagnosis) mirroring Angular 4-step flow calling POST /diagnosis/analyse; show disclaimer + causes + cost + safe-to-drive.
3. FIX ApiService.getAIValuation — Change to POST `${api}/listings/${id}/valuate` with auth, or delete the dead helper if unused.
4. NEXT VALUATION PAGE — Add /ai-valuation (or /valuate) standalone tool using same contract as Angular (low/mid/high + method badge), or clearly link from home to listing flow.

P2:
5. HISTORY UI — On /vehicle-diagnosis, if logged in, pass user_id and show “Past diagnoses” list from GET /diagnosis/history.
6. PLAYWRIGHT — e2e: /vehicle-diagnosis overheating path shows Critical/not safe; /ai-valuation fallback banner when Edge fails.

Also open a PR to merge claude/gaadiiq-app-dev-abj5fo into master (diagnosis + valuation fixes are missing from master today).

Acceptance:
- User can attach ≥1 photo to a diagnosis and see it reflected in API payload.
- Next has a usable diagnosis page with disclaimer.
- No references to GET /ai/valuation/{id}.
- Logged-in user sees at least one history row after analyse with user_id.
```

## How to re-run

```bash
git checkout cursor/ai-diagnosis-revalidate-85e1   # or claude/gaadiiq-app-dev-abj5fo
python3 docs/qa/revalidate_ai_diagnosis.py
cd apps/api && PYTHONPATH=. python3 -m pytest tests/test_valuation.py -k 'test_heuristic_' -q
```
