# Claude Code Fix Prompts — AI Diagnosis BRD Gaps

Source: `docs/qa/diagnosis/GAADIIQ_AI_Diagnosis_BRD_and_QA.md`  
BRD readiness: **63/100**

---

## Wave 0 — Context

```
You are closing GAADIIQ AI Diagnosis BRD gaps (apps/gaadiiq-angular + apps/api).

KEEP WORKING: manual wizard, voice overlay (11 langs), extract, analyse, image upload,
client KB fallback, Ollama path, disclaimers, MOB-007 authz, TTS controls.

DO NOT BREAK: Hindi/Bengali/Tamil extraction, safe-to-drive UI, rate limits.

Implement only IDs listed in each wave. Add tests for every Must-Have fix.
```

---

## Wave 1 — P0 Must-Have blockers

```
BR-SEC-04 + BR-SEC-01 + BR-AND-01 — Mic consent + Android RECORD_AUDIO
- Consent modal before STT (purpose, retention, privacy link).
- AndroidManifest RECORD_AUDIO; Capacitor permission helper.
- Denied → clear error + settings guidance.

BR-API-01 + BR-VA-01 — Server STT fallback
- POST /diagnosis/stt (multipart) via env-configured Whisper/Google/Azure.
- If Web Speech unsupported / WebView: MediaRecorder → /diagnosis/stt.
- Keep browser STT when available.

BR-IR-04 + BR-API-07 — Audio upload
- POST /upload/audio (auth, magic bytes, max 60s).
- Step 2 record/upload UI → DiagnoseRequest.audio_url (column exists).

BR-TEST-01 — Tests
- apps/api/tests/test_diagnosis.py (analyse, validation, history, IDOR, voice/extract, stt mocked).
- Unit tests for vehicle-info-extractor (en/hi) + voice error map.

Also harden prompt fencing for problem_description (MOB-008).

Acceptance: mic consent on APK; WebView STT path works; pytest diagnosis green.
```

---

## Wave 2 — Multilingual + history

```
BR-ML-01 — Wire autoDetectLanguage (optional Auto-detect toggle) + manual picker.
BR-ML-02/04 — Localize PROMPTS for kn/ml/gu/pa/or OR translate via TTS; banner if translation fails.
BR-UX-03 — Angular Past diagnoses panel (GET /diagnosis/history) for logged-in users.
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
Implement ONLY {REQ_ID}. Add tests. Do not regress voice multilingual extract or disclaimer.
```
