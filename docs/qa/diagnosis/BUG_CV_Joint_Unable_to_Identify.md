# Bug: Common CV-joint symptom → “Unable to identify”

| Field | Value |
|-------|-------|
| Date | 2026-07-25 |
| Tip checked | `claude/gaadiiq-app-dev-abj5fo` (incl. post–4963cc4) |
| Repro | Alto K10 2017 · Petrol/Manual · 60,000 km · Severity High · Occurs: Low Speed + Always · Problem: **“Loud clicks when making sharp turns”** |
| Expected | Preliminary diagnosis ≈ **worn/failing CV (constant velocity) joint / axle** |
| Actual | Client fallback (and heuristic when KB miss + Ollama down): **“Unable to identify a specific issue…”** |

---

## Root cause (3 stacked failures)

### 1. No CV-joint knowledge case
`apps/api/data/repair_knowledge.json` has only **12** cases. Closest is **RK008 Suspension** (“knocking when turning”) — **no** symptoms for:
`click` / `clicks` / `clicking` / `sharp turn` / `CV joint` / `axle` / `drive shaft` / `grease boot`.

### 2. Client fallback exact-word match misses plurals + has no CV keywords
`apps/gaadiiq-angular/.../diagnosis.service.ts` → `clientFallback()`:

- Uses **exact** `words.has(s)` (no stemming): user says **“clicks”**, battery keyword is **“click”** → no match.
- Suspension keywords are `suspension|steering|noise|bump|…` — **no** `click(s)`, `turn(s)`, `cv`, `axle`.
- Score stays **0** → `best === null` → hard-coded:

> Unable to identify a specific issue from the symptoms provided…

This path is what users see when the API is down **or** (historically) when analyse returned 422 and Angular always fell back.

### 3. Server keyword retrieval is stopword-weak and CV-blind
`_retrieve_relevant_cases` intersects bag-of-words. For this problem, overlap with RK008 is often only **“when”** (from “knocking **when** turning”). No strong CV signal. If Ollama is unavailable, `_heuristic_fallback` with empty/weak retrieve also yields “Unable to identify…”.

---

## Why this feels broken
“Loud clicks on sharp turns” is one of the most common Indian FWD car complaints (outer CV joint). The product fails the obvious case because the KB + client synonym list never modeled it, and plural/stemming was removed to fix overheating false positives (`c2845fc`) without adding a CV case or light stemming (`click`/`clicks`).

---

## Fix requirements (for Claude)

1. Add **RK013 CV Joint / Axle Click** to `repair_knowledge.json` + mirror case in Angular `KB[]`.
2. Client keywords: `click`, `clicks`, `clicking`, `cv`, `axle`, `joint`, `turn`, `turns`, `turning`, `sharp` (phrase boost: click* + turn*).
3. Disambiguate battery “click” (with start/crank/dead) vs CV “click” (with turn/steer/corner).
4. Light stemming or synonym map: `clicks→click`, `turns→turn`, `knocking→knock`.
5. Drop stopwords (`when`, `the`, `and`, …) from server retrieval scoring.
6. Golden test: this exact Alto K10 payload must **not** return “Unable to identify”.

Claude prompt: `Claude_Fix_Prompt_CV_Joint.md`
