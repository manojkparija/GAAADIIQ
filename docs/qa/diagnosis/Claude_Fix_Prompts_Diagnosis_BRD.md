# Claude Code Fix Prompts — AI Diagnosis BRD Gaps

Source: `docs/qa/diagnosis/GAADIIQ_AI_Diagnosis_BRD_and_QA.md`  
BRD readiness: **63/100**  
Code base for fixes: **`claude/gaadiiq-app-dev-abj5fo`** (voice stack). Do not implement voice against master-only tree.

---

## MASTER PROMPT (paste into Claude Code)

```
# ROLE
You are implementing GAADIIQ AI Diagnosis BRD gaps as a senior full-stack engineer.
Repo: monorepo with apps/gaadiiq-angular (Capacitor) + apps/api (FastAPI).

# BASELINE (KEEP WORKING — DO NOT REGRESS)
- Manual 4-step wizard on /vehicle-diagnosis
- Voice overlay: 11 Indian languages, Web Speech STT, speechSynthesis TTS
- vehicle-info-extractor + POST /diagnosis/voice/extract
- Missing-field TTS asks, autofill, detected_language → analyse translate
- Image upload POST /upload/image, Ollama + keyword KB + heuristic fallback
- Past Diagnoses history panel + GET /diagnosis/history
- MOB-007 IDOR owner check on GET /diagnosis/{id}
- safe_to_drive UI, disclaimers, TTS play/pause/stop/replay

# DO NOT BREAK
Hindi/Bengali/Tamil extraction, rate limits, disclaimer, clientFallback, history list.

# SOURCE OF TRUTH
Read docs/qa/diagnosis/GAADIIQ_AI_Diagnosis_BRD_and_QA.md and implement waves below.
After each wave: add/adjust tests; summarize PASS/FAIL for touched requirement IDs.

# WAVE 1 — P0 (implement first, one PR)
1) BR-SEC-04 + BR-SEC-01 + BR-AND-01 — Mic consent + Android RECORD_AUDIO
   - Pre-STT consent modal: purpose, retention, privacy link, Accept/Decline.
   - Persist consent version+timestamp (local + optional API).
   - AndroidManifest RECORD_AUDIO; Capacitor permission helper before getUserMedia/STT.
   - Denied → clear error + OS settings guidance (never silent fail).

2) BR-API-01 + BR-VA-01 — Server STT fallback
   - POST /diagnosis/stt (multipart audio) via env Whisper/Google/Azure (mockable).
   - If Web Speech unsupported OR WebView flag: MediaRecorder → /diagnosis/stt.
   - Keep browser STT when available.

3) BR-IR-04 + BR-API-07 — Audio upload
   - POST /upload/audio (auth, magic bytes, max 60s, allowlist mime).
   - Step 2 record/upload UI → DiagnoseRequest.audio_url (column already exists).
   - Do not send audio into LLM until validated; store URL on vehicle_diagnoses.

4) BR-TEST-01 — Tests
   - apps/api/tests/test_diagnosis.py: analyse happy/422, history auth, IDOR, voice/extract mocked, stt mocked.
   - Unit tests: vehicle-info-extractor (en + hi) + voice error map.
   - Harden prompt fencing for problem_description (MOB-008).

Acceptance Wave 1: consent on APK path; WebView STT path works with mock STT; pytest diagnosis green.

# WAVE 2 — Multilingual + history depth
- BR-ML-01: Auto-detect toggle wired (optional) + manual picker remains.
- BR-ML-02/04: Localize PROMPTS for kn/ml/gu/pa/or OR translate; show banner if translation fails.
- BR-UX-03: From Past Diagnoses, open GET /diagnosis/{id} detail; keep list working.
- BR-AI-10: Return follow_up_questions[] when confidence low; render + optional voice ask.

# WAVE 3 — Media, DB, privacy, RAG
- BR-IR-05: Video upload → video_url.
- BR-IR-07: maintenance_history on Step 2 → API/DB JSON.
- BR-DB-01/02/04: Alembic voice_transcripts, diagnosis_conversations, diagnosis_audit_events (consent-gated).
- BR-SEC-05/06: DELETE diagnosis + delete voice data (DPDP).
- BR-AI-02: Embedding RAG over repair_knowledge (reuse Qdrant/BGE if available) + keyword fallback.
- BR-API-02: Optional server TTS; client speechSynthesis fallback.
- NFR-P1: Ollama timeout (e.g. 8s) → fallback; structured latency logs.

# WAVE 4 — Polish
- BR-VA-08/09: Driving mode (larger targets, hands-free loop).
- BR-UX-01/06: Mobile shell + offline banner/queue.
- BR-PERF-02/03: Golden fixtures for STT/AI (CI informational).
- TC-A-02: aria-live for interim transcript.

# DONE DEFINITION
Requirement IDs in the wave move to PASS (or documented PARTIAL with test proof).
No regression on manual diagnose or Hindi voice extract.
```

---

## Wave 0 — Short context (if splitting chats)

```
Closing GAADIIQ AI Diagnosis BRD gaps on claude/gaadiiq-app-dev-abj5fo.
KEEP: voice overlay, extract, analyse, images, history panel, disclaimers, MOB-007.
DO NOT BREAK: hi/bn/ta extract, safe-to-drive, rate limits.
Implement only listed IDs; add tests for Must-Haves.
```

---

## Wave 1 — P0 only (compact)

```
Implement BR-SEC-04, BR-SEC-01, BR-AND-01, BR-API-01, BR-VA-01, BR-IR-04, BR-API-07, BR-TEST-01, MOB-008 fencing.
Details in docs/qa/diagnosis/Claude_Fix_Prompts_Diagnosis_BRD.md MASTER PROMPT Wave 1.
```

---

## Wave 2 — Multilingual + history depth

```
BR-ML-01 — Wire autoDetectLanguage (optional Auto-detect toggle) + manual picker.
BR-ML-02/04 — Localize PROMPTS for kn/ml/gu/pa/or OR translate; banner if translation fails.
BR-UX-03 — Open diagnosis detail from Past Diagnoses (GET /diagnosis/{id}); list already exists.
BR-AI-10 — Return follow_up_questions[] when confidence low; render + optional voice ask.
```

---

## Wave 3 — Media, DB, privacy, RAG

```
BR-IR-05 — Video upload → video_url.
BR-IR-07 — maintenance_history on Step 2 → API/DB JSON.
BR-DB-01/02/04 — Alembic: voice_transcripts, diagnosis_conversations, diagnosis_audit_events (consent-gated).
BR-SEC-05/06 — DELETE diagnosis + delete voice data (DPDP).
BR-AI-02 — Embedding RAG over repair_knowledge (reuse Qdrant if available) + heuristic fallback.
BR-API-02 — Optional server TTS; client speechSynthesis fallback.
NFR — Ollama timeout (e.g. 8s) → fallback; structured logs.
```

---

## Wave 4 — Polish

```
BR-VA-08/09 — Driving mode (larger targets, hands-free loop).
BR-UX-01/06 — Mobile shell + offline banner/queue.
BR-PERF-02/03 — Golden fixtures for STT/AI accuracy (CI informational).
A11y — aria-live for interim transcript.
```

---

## Single-issue template

```
Read docs/qa/diagnosis/GAADIIQ_AI_Diagnosis_BRD_and_QA.md requirement {REQ_ID}.
Implement ONLY {REQ_ID} on the Claude voice tip branch. Add tests.
Do not regress voice multilingual extract, Past Diagnoses list, or disclaimer.
```
