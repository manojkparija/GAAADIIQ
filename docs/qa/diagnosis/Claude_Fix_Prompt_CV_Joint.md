# Claude Code Prompt — Fix CV-joint “Unable to identify”

```
# BUG
AI Diagnosis cannot diagnose a very common issue:

Vehicle: Maruti Suzuki Alto K10, 2017, Petrol, Manual, 60,000 km
Severity: High
Occurs: Low Speed Driving, Always / Constantly
Problem: "Loud clicks when making sharp turns"

Expected: Worn/failing outer CV joint (constant velocity joint) / axle shaft
Actual: "Unable to identify a specific issue from the symptoms provided…"

# ROOT CAUSE (confirmed)
1. repair_knowledge.json has NO CV-joint case (only 12 cases). RK008 is suspension
   "knocking when turning" — missing click/CV/axle synonyms.
2. Angular clientFallback() uses exact word match: "clicks" ≠ "click"; Suspension
   KB has no click/turn/cv keywords → score 0 → Unable to identify.
3. Server _retrieve_relevant_cases scores stopwords like "when"; no CV terms.

Read: docs/qa/diagnosis/BUG_CV_Joint_Unable_to_Identify.md

# IMPLEMENT (apps/api + apps/gaadiiq-angular)

## 1) Add knowledge case RK013 — CV Joint / Axle Click
File: apps/api/data/repair_knowledge.json

symptoms (include):
- loud clicks when turning
- clicking on sharp turns
- click when cornering
- CV joint noise
- axle click
- torn CV boot
- clicking while accelerating in a turn

possible_causes:
- Worn outer CV joint
- Damaged/torn CV boot (grease loss)
- Worn inner CV joint / tripode
- Loose axle nut / wheel bearing (differential)

complexity: Moderate
cost_min: 2500, cost_max: 12000 (INR typical India range OK)
repair_time: 1–3 hours
safe_to_drive: false (can fail suddenly)
risk: High
diy: Inspect inner fender/CV boot for tears & grease; note which side clicks on lock-to-lock turns
fix guidance: Replace CV axle / outer joint; inspect boot; alignment check after

## 2) Mirror in Angular client KB
File: apps/gaadiiq-angular/src/app/services/diagnosis.service.ts
Add KB case "CV Joint / Axle Click" with symptoms including:
click, clicks, clicking, cv, axle, joint, turn, turns, turning, corner, sharp
AND phrase/co-occurrence boost: (click* AND turn*) scores higher than battery.

## 3) Disambiguate battery vs CV "click"
Battery keywords may keep "click" ONLY when co-occurring with start|crank|dead|battery|ignition.
If click* co-occurs with turn*|corner*|steer*|sharp → prefer CV case, never battery.

## 4) Light normalisation before match (client + server)
- Lowercase, strip punctuation
- Simple stems/synonyms: clicks→click, clicking→click, turns→turn, turning→turn,
  knocking→knock, clunking→clunk
- Remove stopwords from retrieval score: when, the, a, an, and, or, of, to, for, with, during, making

## 5) Server retrieval
Update _retrieve_relevant_cases to use normalised tokens + stopword filter.
Ensure "Loud clicks when making sharp turns" retrieves RK013 as top hit
(even without Ollama).

## 6) Tests (required)
apps/api/tests/test_diagnosis.py:
- test_cv_joint_click_sharp_turns_retrieves_rk013
- test_heuristic_fallback_cv_joint_not_unable
- test_battery_click_on_start_still_maps_battery (no regression)

Angular (optional but preferred):
- unit test clientFallback for the exact Alto K10 payload → CV joint title,
  NOT "Unable to identify", NOT Battery.

## 7) DO NOT BREAK
- Exact-ish matching that fixed overheating false positives (c2845fc) —
  use stemming/synonyms + co-occurrence, not raw substring on short tokens like "at".
- Mic consent, analyse 201, prompt sanitise, existing pytest suite green.

# ACCEPTANCE
Given the screenshot payload, When user taps Analyse with AI (API up or client fallback),
Then preliminary diagnosis mentions CV joint / axle click (not Unable to identify / not Battery).
pytest test_diagnosis.py green.
```
