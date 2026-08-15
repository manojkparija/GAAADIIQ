# Claude Code Fix Prompts — AI Diagnosis E2E Retest Gaps

**Tip retested:** `claude/gaadiiq-app-dev-abj5fo` @ `4963cc4`  
**BRD readiness now:** **69/100** (was 63)  
**Source:** `docs/qa/diagnosis/AI_Diagnosis_E2E_Retest.md`

---

## Already fixed — DO NOT re-implement / DO NOT regress

```
KEEP WORKING (confirmed PASS on tip 4963cc4):
- Mic consent gate before STT (BR-SEC-04) + consentLogged
- Android RECORD_AUDIO + RecognitionService queries (BR-AND-01)
- Auto-detect language option (BR-ML-01)
- All 11 language PROMPTS including kn/ml/gu/pa/or (BR-ML-02)
- aria-live on transcript / AI / status (TC-A-02)
- vehicle-info-extractor.spec.ts + extractor bugfixes (TC-R-02)
- apps/api/tests/test_diagnosis.py 43 cases (TC-R-01)
- POST /diagnosis/analyse 201 fix (removed PEP 563 + slowapi breakage)
- Prompt-injection _sanitise suite (MOB-008 / TC-S-02)
- Past Diagnoses list, voice overlay, extract, TTS controls, image upload,
  Ollama + keyword KB + heuristic fallback, detected_language translate,
  MOB-007 IDOR on GET /diagnosis/{id}

DO NOT BREAK any of the above.
```

---

## MASTER PROMPT (paste into Claude Code)

```
# ROLE
Close remaining GAADIIQ AI Diagnosis BRD gaps after E2E retest (readiness 69/100).
Work on branch tip that includes commits d2d244b + 4963cc4 (consent, tests, analyse 422 fix).

# READ FIRST
docs/qa/diagnosis/AI_Diagnosis_E2E_Retest.md
docs/qa/diagnosis/Claude_Fix_Prompts_Diagnosis_Retest.md

# KEEP / DO NOT REGRESS
Mic consent, RECORD_AUDIO, auto-detect, 11-lang PROMPTS, aria-live,
extractor specs, test_diagnosis.py (43), analyse 201 path, _sanitise,
voice overlay, Past Diagnoses list, image upload, translate, IDOR.

# WAVE A — P0 production voice/media (implement first)

## A1) BR-API-01 + BR-VA-01 — Server STT + WebView fallback
- Add POST /diagnosis/stt (multipart audio) backed by env-configured
  Whisper/Google/Azure (fully mockable in pytest).
- Response: { transcript, language?, confidence? }
- Angular: if Web Speech unsupported OR Capacitor Android/iOS WebView,
  use MediaRecorder → POST /diagnosis/stt.
- Keep browser SpeechRecognition when available.
- Tests: mocked STT success/fail/empty; MIME rejection.

## A2) BR-IR-04 + BR-API-07 — Audio upload
- POST /upload/audio (auth, magic bytes, allowlist mime, max ~60s).
- Step 2 UI: record or pick audio → set DiagnoseRequest.audio_url
  (column already exists on vehicle_diagnoses).
- Update Angular DiagnoseRequest type to include audio_url.
- CONFLICT: current consent copy says "no audio stored/uploaded".
  Update consent copy to: optional audio may be uploaded if user
  chooses Record/Upload; voice STT text may be processed; link privacy.
- Tests: upload validation + analyse accepts audio_url.

## A3) BR-SEC-05 + BR-SEC-06 + BR-DB-01 — Voice data lifecycle (DPDP)
- Alembic: voice_transcripts (consent-gated; TTL e.g. 30d) + optional
  diagnosis_audit_events for consent/analyse/delete.
- Persist consent server-side when user is logged in (not only localStorage).
- Wire revokeConsent() into a Settings / Diagnosis privacy control.
- DELETE /diagnosis/{id} (owner) and DELETE /diagnosis/voice-data (owner).
- UI: "Delete my voice data" + delete past diagnosis.
- Tests: IDOR on delete; guest cannot delete others.

## A4) iOS mic (TC-IOS-01)
- If ios/ project exists or is generated: set NSMicrophoneUsageDescription
  in Info.plist. If not in repo, add to Capacitor ios template / IOS_SETUP
  as required checklist item enforced in CI docs — prefer real plist when present.

# WAVE B — P1 GA completeness

## B1) BR-UX-03 — Open diagnosis by id
- Past Diagnoses items navigate/open GET /diagnosis/{id} detail view.
- Align history list types with DiagnosisHistoryItem (don’t expect costs
  if API slim); optionally enrich history API with cost fields.

## B2) BR-IR-05 — Video upload → video_url (mirror audio pattern, stricter size).

## B3) BR-IR-07 — maintenance_history textarea/JSON on Step 2 → API/DB.

## B4) BR-PERF-01 — OLLAMA_TIMEOUT ≈ 8s (not 120) → heuristic fallback;
    log latency.

## B5) BR-ML-04 — If translation fails/returns English for non-en request,
    show explicit fallback banner in report UI.
    Add 2–3 golden multilingual fixtures (informational CI OK).

## B6) BR-SEC-01 — Capacitor/runtime mic permission helper before getUserMedia
    (Android + iOS), in addition to manifest/consent.

## B7) BR-API-02 (optional) server TTS; keep speechSynthesis fallback.
## B8) BR-API-03 (optional) POST /diagnosis/detect-language.

# WAVE C — P2 polish
- BR-AI-10: follow_up_questions[] when low confidence; render + optional voice ask.
- BR-AI-02: embedding RAG over repair_knowledge (reuse Qdrant/BGE) + keyword fallback.
- BR-VA-08/09: Driving mode (large targets, hands-free loop).
- BR-DB-02: diagnosis_conversations for multi-turn persistence.
- Offline banner when STT/network unavailable.

# DONE DEFINITION
- Wave A requirement IDs → PASS with tests.
- pytest test_diagnosis.py stays green; add cases for stt/audio/delete.
- No regression on consent, analyse 201, hi/bn/ta extract, disclaimer.
- Summarize each ID as PASS/PARTIAL/FAIL after the PR.
```

---

## Compact Wave A only

```
On tip with d2d244b+4963cc4, implement ONLY Wave A from
docs/qa/diagnosis/Claude_Fix_Prompts_Diagnosis_Retest.md:
server STT + MediaRecorder fallback, audio upload+UI, DPDP delete +
voice_transcripts/audit, update consent copy, iOS mic string.
Keep consent/RECORD_AUDIO/tests/analyse-201. Add pytest coverage.
```

---

## Single-issue template

```
Read docs/qa/diagnosis/AI_Diagnosis_E2E_Retest.md for {REQ_ID}.
Implement ONLY {REQ_ID} on current Claude tip. Add tests.
Do not regress mic consent, analyse 201, extractor specs, or disclaimer.
```
