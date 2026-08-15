# AI Diagnosis — E2E Retest (Post-Fix)

| Field | Value |
|-------|-------|
| Date | 2026-07-25 16:54 UTC |
| Code tip | `claude/gaadiiq-app-dev-abj5fo` @ `4963cc4` |
| Prior audit | BRD readiness **63/100** (docs PR #24) |
| Method | Static E2E + code review + `pytest tests/test_diagnosis.py` (**43 passed**) |
| Verdict | **Still NO-GO for full BRD** · **Conditional Go expanded** (manual + browser voice beta + images) |

---

## Executive scores

| Metric | Prior | Now | Δ |
|--------|------:|----:|--:|
| BRD readiness | 63 | **69** | +6 |
| Requirements PASS | 31 | **35** | +4 |
| Requirements PARTIAL | 19 | **18** | −1 |
| Requirements FAIL | 14 | **11** | −3 |
| Test scenarios PASS | 23 | **32** | +9 |
| Test scenarios PARTIAL | 6 | **5** | −1 |
| Test scenarios FAIL | 18 | **10** | −8 |
| API diagnosis pytest | 0 | **43 passed** | new |

**Verdict:** Several Wave-1 blockers are fixed, but production voice/media BRD is **not** complete. Remaining P0: **server STT**, **audio upload**, **DPDP delete / transcript DB**.

---

## What Claude fixed (confirmed)

| Commit | Fix |
|--------|-----|
| `d2d244b` | Mic consent gate before STT; `RECORD_AUDIO` + RecognitionService queries; Auto-detect language; all 11 PROMPTS localized; aria-live; extractor unit tests + 4 extractor bugs |
| `4963cc4` | **Critical:** `POST /diagnosis/analyse` was **always 422** (PEP 563 + slowapi); fixed + `test_diagnosis.py` (43 cases) incl. prompt-injection, IDOR, translate, voice/extract |

### Requirement status changes

| ID | Prior | Now | Evidence |
|----|-------|-----|----------|
| BR-SEC-04 | FAIL | **PASS** | Consent screen before STT; `VoiceDiagnosisService.start()` gated |
| BR-AND-01 | FAIL | **PASS** | `AndroidManifest` `RECORD_AUDIO` (+ audio media perms) |
| BR-TEST-01 | FAIL | **PASS** | `apps/api/tests/test_diagnosis.py` + `vehicle-info-extractor.spec.ts` |
| BR-ML-01 | PARTIAL | **PASS** | “Detect automatically” wires `autoDetectLanguage()` |
| BR-ML-02 | PASS* | **PASS** | kn/ml/gu/pa/or prompts localized (was 6 only) |
| MOB-008 / TC-S-02 | PARTIAL | **PASS** | `_sanitise` + injection suite |
| TC-A-02 | FAIL | **PASS** | `aria-live` on interim transcript / AI / status |

\*Prior note said localization incomplete; now cleared.

### Critical production bug found & fixed during test writing
Angular UI hid that **every** `/diagnosis/analyse` call returned **422** — client `clientFallback()` always rendered a report. Tip now returns **201** with mocked Ollama (pytest green).

---

## Remaining gaps (must fix)

### P0 — production blockers

| ID | Status | Gap |
|----|--------|-----|
| BR-API-01 / BR-VA-01 | FAIL / PARTIAL | No `POST /diagnosis/stt`; WebView still browser-STT only; no MediaRecorder fallback |
| BR-IR-04 / BR-API-07 | FAIL | No `POST /upload/audio` / UI; `audio_url` unused; consent copy says “no audio stored” (conflicts with BRD audio upload) |
| BR-SEC-05 / BR-SEC-06 | FAIL / PARTIAL | `revokeConsent()` exists but unused; no DELETE diagnosis/voice APIs; no DPDP UX |
| BR-DB-01 / BR-DB-02 / BR-DB-04 | FAIL | No `voice_transcripts`, `diagnosis_conversations`, `diagnosis_audit_events` (consent only in `localStorage`) |

### P1 — Should-have for GA

| ID | Status | Gap |
|----|--------|-----|
| BR-IR-05 | FAIL | No video upload (`video_url` column unused) |
| BR-IR-07 | FAIL | No `maintenance_history` |
| BR-API-02 | FAIL | No server TTS (client `speechSynthesis` only) |
| BR-API-03 | FAIL | No `POST /diagnosis/detect-language` |
| BR-UX-03 | PARTIAL | Past Diagnoses list works; **no open-by-id detail**; history item cost fields mismatch API slim shape |
| BR-ML-04 | PARTIAL | Translate path exists; no EN-fallback banner; no golden multilingual QA |
| BR-SEC-01 | PARTIAL | Manifest OK; no Capacitor runtime mic permission helper |
| BR-PERF-01 | PARTIAL | `OLLAMA_TIMEOUT = 120s` — need ~8s → fallback |
| iOS | FAIL | No checked-in `Info.plist` / `NSMicrophoneUsageDescription` (docs-only in `IOS_SETUP.md`) |

### P2 — polish

| ID | Status | Gap |
|----|--------|-----|
| BR-AI-02 | PARTIAL | Keyword KB only (not vector RAG) |
| BR-AI-10 | PARTIAL | No post-diagnosis `follow_up_questions[]` |
| BR-VA-08/09 | PARTIAL | No driving / hands-free mode |
| BR-UX-06 | PARTIAL | Offline STT still impossible without server STT |

---

## E2E scenario retest matrix (highlights)

### Now PASS (was FAIL/PARTIAL)

| ID | Result | Note |
|----|--------|------|
| TC-F-15 | PASS | Auto language detect option |
| TC-F-16 | PASS | 11-language PROMPTS |
| TC-F-19 | PASS | Mic consent before STT |
| TC-F-20 | PASS | Android `RECORD_AUDIO` |
| TC-S-05 | PASS | `consentLogged` audit event (client) |
| TC-A-02 | PASS | aria-live |
| TC-R-01 | PASS | 43 pytest cases |
| TC-R-02 | PASS | Extractor specs (caught real bugs) |
| TC-S-02 | PASS | Prompt-injection sanitisation |
| TC-F-28 (new) | PASS | Analyse returns 201 (not silent 422→fallback) |

### Still FAIL

| ID | Sev | Detail |
|----|-----|--------|
| TC-F-12 | P0 | Audio upload |
| TC-F-13 | P0 | Video upload |
| TC-F-14 | P1 | Maintenance history |
| TC-F-18 | P0 | Server STT / WebView |
| TC-F-21 | P1 | Persist conversation transcripts |
| TC-F-22 | P1 | Delete voice data (DPDP) |
| TC-F-23 | P2 | Post-diagnosis follow-ups |
| TC-F-24 | P2 | Vector RAG |
| TC-F-25 | P2 | Open past diagnosis by id |
| TC-S-04 | P1 | Audio upload validation |
| TC-P-02 | P1 | STT offline |
| TC-IOS-01 (new) | P0 | iOS mic usage string in app project |

---

## Conditional Go scope (updated)

| Scope | Verdict |
|-------|---------|
| Manual form + images + **real** API analyse + disclaimer | **GO** (with tip `4963cc4+`) |
| Browser voice (Chrome) + consent + 11 langs | **Beta GO** |
| Android WebView voice production | **NO-GO** (needs server STT) |
| Audio/video/DPDP/full BRD | **NO-GO** |

**Overall BRD readiness: 69/100.**

Claude fix prompt: `Claude_Fix_Prompts_Diagnosis_Retest.md`
