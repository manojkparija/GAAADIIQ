# AI Diagnosis — E2E Test Plan and Validation Report

**Version:** 1.0
**Date:** 2026-08-14
**Suite:** `apps/api/tests/test_diagnosis_e2e.py`
**Data:** `apps/api/tests/data/diagnosis_e2e_seed.py`
**Executed against:** PostgreSQL 16 + Redis, through the real ASGI app.

---

## 1. Result

| | |
|---|---|
| Cases executed | **72** |
| Passed | **71** |
| Failed | 0 |
| Known defect, pinned | 1 (`xfail(strict=True)`) |
| **Defects found** | **2 — one of them a total outage of the feature** |

Both defects were invisible to the existing tests. That is the finding behind
the finding, and §5 says why.

---

## 2. Scope

**In scope.** `POST /diagnosis/analyse` and the `/admin/diagnosis-kb/*` surface,
driven over HTTP with a real database and the real dependency graph: request
contract, the knowledge-base ladder, vehicle scoping, the two publication gates,
safety semantics, the response cache, the review workflow, authorisation, and
persistence.

**Out of scope, deliberately.** No external model is called. Gemini and Ollama
are unreachable from CI, and a test whose verdict depends on a third party is a
test that fails on their bad day rather than ours. Cases either expect a
knowledge-base answer — which involves no model — or assert the *shape* of the
fall-through, not its content. Voice (STT/TTS) is also out: both providers
default to `"none"` and are unset in production.

---

## 3. Test data

Ten diagnoses, five solutions and fifteen aliases, all built to force one
decision each rather than to look realistic in bulk.

| Code | Exists to prove |
|---|---|
| `DX-BRK-001` | Safety-critical, `CanDrive.NO` — must never be cached |
| `DX-BRK-002` | Same symptom, different maker — scope must choose |
| `DX-ENG-001` | Year band 2015–2018 — must refuse a 2023 car |
| `DX-ENG-002` | Odometer band 60k–200k — must refuse a 12,000 km car |
| `DX-AC-001` | `ANY` scope, low severity — the cacheable case |
| `DX-DTC-001` | Carries `P0301` — a DTC must outrank prose |
| `DX-CVT-001` vs `DX-GBX-001` | Specific row (confidence 0.75) must beat generic (0.99) |
| `DX-DRAFT-1` | `DRAFT` / `PENDING_REVIEW` — invisible |
| `DX-REJ-001` | `ACTIVE` + `PENDING_REVIEW` — one gate is not enough |
| `DX-AI-001` | `AI_GENERATED` — approval requires a note |

The vehicles are the ones Indian owners actually drive — Swift, Nexon, Creta,
i20, Baleno, Ertiga CNG, Seltos — and the complaints include **Hinglish**
(`"brake se awaaz aa rahi hai"`, `"gaadi jhatke maar rahi hai"`), because that
is how the input really arrives and a keyword matcher was never going to cope.

Costs are order-of-magnitude realistic **but are test fixtures**. They must
never be copied into the production corpus, which requires a cited source.

---

## 4. Defects

### DEFECT-01 — every knowledge-base answer returned HTTP 500 · **Critical** · fixed

`services/diagnosis_kb_lookup.py::to_result` emitted
`possible_causes[].likelihood` as a string. `routers/diagnosis.py::PossibleCause`
requires `confidence: float`. Response validation therefore failed on **every
single knowledge-base answer**:

```
pydantic_core.ValidationError: 1 validation error for PossibleCause
POST /diagnosis/analyse → 500
```

The whole KB-first feature — the alias rung, the exact rung, the semantic rung,
the cache — was unreachable through the API. Not degraded: a 500.

**Fixed** by emitting `confidence` as a float derived from the row's
`confidence_score`. 20 cases moved from fail to pass on that one line.

### DEFECT-02 — an ownerless report is readable by any signed-in user · **Low** · **fixed**

`routers/diagnosis.py::get_diagnosis` guards with:

```python
if record.user_id and str(record.user_id) != str(current_user.id):
    raise HTTPException(403)
```

`/diagnosis/analyse` needs no authentication, so an anonymous diagnosis is
stored with `user_id = NULL`. The guard then short-circuits, and **any**
authenticated user can read it. The docstring says "owner-only (fixes IDOR
MOB-007)"; for an ownerless record it is closer to "anyone-only".

Exploitability is limited: the id is a v4 UUID and is returned only to the
creator. The contract is still not what it claims.

**Fixed.** The guard now refuses unless `record.user_id` matches — a NULL owner
is nobody, not everybody — and answers **404** rather than 403, matching
`delete_diagnosis_report`, so "not found" and "not yours" stay
indistinguishable and the endpoint cannot be used to probe for report IDs.
`test_DX_E2E_0704` is no longer `xfail`; it passes.

### Two test-harness faults found and fixed along the way

Recorded because both were mine, and both are the kind that produce a false
green somewhere else:

- **Restoring a shared flag to an assumed value.** The fixture set
  `app.state.limiter.enabled = True` on teardown. The limiter is built with
  `enabled=settings.is_production`, so it is *already off* in tests — the
  teardown switched it **on** for every file that ran afterwards, and
  `/auth/register` began returning 429 in an unrelated suite. Now the previous
  value is captured and restored.
- **Resetting only half the cache.** `diagnosis_cache._reset_for_tests()` clears
  the in-process dict but not the `dx:*` keys in Redis, so cached answers
  survived *between pytest runs*. The fixture now awaits `invalidate_all()`
  first. Worth knowing for any future suite that touches the cache.

---

## 5. Why the existing tests missed a 500 on the happy path

The 39 unit tests in `test_diagnosis_kb_lookup.py` all pass, and DEFECT-01 was
still shipped. Three layers each looked fine on their own:

1. Unit tests asserted on the **dict returned by `to_result`** — where
   `likelihood` is a perfectly good key.
2. My earlier manual E2E called **`run_diagnosis` directly**, which returns the
   same dict and never touches the response model.
3. The Pydantic model sits between the service and the wire, and **nothing
   crossed it** until this suite.

A response model is a contract, and a contract is only tested by exercising
both sides. That is the whole argument for a suite at this level.

---

## 6. Case index

Numbering is `DX-E2E-nnnn`; the test function names carry the same ids.

| Group | Cases | What it establishes |
|---|---|---|
| **01xx — request contract** | 0101–0106 | 201 on valid input; all six fuel types (CNG and LPG included) and all five transmissions accepted; eight invalid inputs refused with 422; no auth required; tier cannot be claimed via `user_id` in the body |
| **02xx — the ladder** | 0201–0210 | Alias match answers from the KB; Hinglish understood; same symptom on a different car yields a different row; year and odometer bands respected in both directions; `ANY` scope answers any car; a specific row beats a generic one with higher confidence; a two-letter alias does not fire inside a longer word; an unknown complaint degrades rather than errors |
| **03xx — safety** | 0301–0305 | Safety-critical says do not drive; a temporary fix is labelled temporary; low severity does not cry wolf; solutions ordered cheapest first; every answer carries the disclaimer |
| **04xx — the two gates** | 0401–0405 | A draft is invisible; `ACTIVE` alone is not enough; approval makes a row answerable end to end; `AI_GENERATED` cannot be approved silently; rejection withdraws the row but keeps it |
| **05xx — admin & authz** | 0501–0508 | Seven admin routes refuse an anonymous caller **in production mode**; the dev bypass is pinned as gated; stats, queue ordering, AI separation, detail view, decision record, 404 on unknown id, a solution cannot be published under a draft |
| **06xx — cache** | 0601–0605 | A repeat question is served from cache; a safety-critical answer never is; the cache does not leak across vehicles; withdrawing a row invalidates it; stats visible to admin |
| **07xx — persistence** | 0701–0704 | Every request is recorded; anonymous read refused; the owned-report IDOR guard holds; the ownerless gap pinned |
| **08xx — config guards** | 0801–0804 | Production refuses to boot without RS256 keys; this backend signs RS256; `/health/dependencies` reports what is actually serving; it leaks no secrets |

---

## 7. Running it

```bash
cd apps/api

# SQLite — fast, and what CI's first job does
pytest tests/test_diagnosis_e2e.py -q

# PostgreSQL — the one that matters; native enums, FK enforcement, casting
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/gq_e2e \
  pytest tests/test_diagnosis_e2e.py -q
```

Redis is optional. Without it the cache falls back to a per-process dict and the
06xx cases still pass — they assert cache *behaviour*, not the backend.

---

## 8. Coverage this suite does not give you

Stated plainly, because a passing suite invites the assumption that it does.

- **No browser here.** This suite is HTTP-only. The Angular diagnosis page is
  covered by `apps/gaadiiq-angular/e2e/voice-diagnosis.spec.ts`, which does run
  in CI's web job for the `desktop-chrome` project.
- **No real model.** The Gemini and Ollama rungs are asserted only as
  fall-through shape. Prompt quality, refusals and truncation are untested here.
- **No load.** No concurrency, and no p95 for the KB path. A single
  knowledge-base answer measured single-digit milliseconds against local
  Postgres; that is one measurement on an idle machine, not a latency budget.
- **No production data.** The knowledge base is empty in production and imported
  rows arrive as drafts, so today this whole path is dormant behind the review
  queue regardless of how green the suite is.
