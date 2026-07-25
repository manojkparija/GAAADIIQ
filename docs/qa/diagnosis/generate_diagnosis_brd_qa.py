#!/usr/bin/env python3
"""Generate AI Diagnosis BRD, E2E test matrix, gaps, Claude prompts."""
from __future__ import annotations

import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

QA = Path(__file__).resolve().parent
ART = Path("/opt/cursor/artifacts/ai-diagnosis-brd-qa")
QA.mkdir(parents=True, exist_ok=True)
ART.mkdir(parents=True, exist_ok=True)

# id, area, priority, requirement, status, evidence, gap
REQS: list[tuple[str, str, str, str, str, str, str]] = [
    ("BR-VI-01", "Vehicle Info", "Must Have", "Manual vehicle information entry", "PASS", "Angular Step 1 form", "—"),
    ("BR-VI-02", "Vehicle Info", "Must Have", "Voice-based vehicle information entry", "PASS", "voice-mode overlay + STT", "—"),
    ("BR-VI-03", "Vehicle Info", "Must Have", "Auto-extract vehicle details from speech", "PASS", "vehicle-info-extractor + /voice/extract", "—"),
    ("BR-VI-04", "Vehicle Info", "Must Have", "Auto-fill of vehicle information", "PASS", "onVoiceCompleted merges form", "—"),
    ("BR-VI-05", "Vehicle Info", "Must Have", "Intelligent validation", "PASS", "step1Valid + Pydantic", "—"),
    ("BR-VI-06", "Vehicle Info", "Must Have", "Missing information prompts", "PASS", "voice-mode _askMissingFields", "—"),
    ("BR-IR-01", "Issue Reporting", "Must Have", "Report issue using text", "PASS", "Step 2 textarea", "—"),
    ("BR-IR-02", "Issue Reporting", "Must Have", "Report issue using voice", "PASS", "Step 2 mic + overlay", "—"),
    ("BR-IR-03", "Issue Reporting", "Must Have", "Upload vehicle images", "PASS", "POST /upload/image", "—"),
    ("BR-IR-04", "Issue Reporting", "Must Have", "Upload audio recordings", "FAIL", "Schema audio_url only", "No UI/API upload"),
    ("BR-IR-05", "Issue Reporting", "Must Have", "Upload videos", "FAIL", "Schema video_url only", "No video upload"),
    ("BR-IR-06", "Issue Reporting", "Must Have", "Select dashboard warning lights", "PASS", "WARNING_LIGHTS chips", "—"),
    ("BR-IR-07", "Issue Reporting", "Should Have", "Add maintenance history", "FAIL", "Not in form/API", "No maintenance_history field"),
    ("BR-ML-01", "Multilingual", "Must Have", "Automatic language detection", "PARTIAL", "detectLanguageFromText unwired", "Wire autoDetect into voice session"),
    ("BR-ML-02", "Multilingual", "Must Have", "Support major Indian languages", "PASS", "11 VOICE_LANGUAGES", "Prompts fully localized for 6 only"),
    ("BR-ML-03", "Multilingual", "Must Have", "Preserve user language in conversation", "PASS", "gq_voice_lang + detected_language", "—"),
    ("BR-ML-04", "Multilingual", "Must Have", "AI responses match user language", "PARTIAL", "_translate_diagnosis via Ollama", "Quality untested; may stay EN"),
    ("BR-VA-01", "Voice AI", "Must Have", "Speech-to-Text", "PARTIAL", "Browser Web Speech only", "No server STT; WebView risk"),
    ("BR-VA-02", "Voice AI", "Must Have", "Text-to-Speech", "PARTIAL", "speechSynthesis only", "No server TTS"),
    ("BR-VA-03", "Voice AI", "Must Have", "Live transcription", "PASS", "interimText UI", "—"),
    ("BR-VA-04", "Voice AI", "Should Have", "Voice playback", "PASS", "Auto-speak report + TTS bar", "—"),
    ("BR-VA-05", "Voice AI", "Should Have", "Replay", "PASS", "replaySpeaking", "—"),
    ("BR-VA-06", "Voice AI", "Should Have", "Pause", "PASS", "pauseSpeaking", "—"),
    ("BR-VA-07", "Voice AI", "Should Have", "Stop", "PASS", "stop STT/TTS", "—"),
    ("BR-VA-08", "Voice AI", "Should Have", "Hands-free mode", "PARTIAL", "Auto-listen after TTS", "No always-on driving mode"),
    ("BR-VA-09", "Voice AI", "Should Have", "Driver-friendly interaction", "PARTIAL", "Large overlay", "No driving mode; RECORD_AUDIO gap"),
    ("BR-AI-01", "AI Diagnosis", "Must Have", "Ollama LLM integration", "PASS", "services/diagnosis.py", "—"),
    ("BR-AI-02", "AI Diagnosis", "Must Have", "RAG knowledge base", "PARTIAL", "Keyword KB 12 cases", "Not vector RAG for diagnosis"),
    ("BR-AI-03", "AI Diagnosis", "Must Have", "Root cause prediction", "PASS", "possible_causes[]", "—"),
    ("BR-AI-04", "AI Diagnosis", "Must Have", "Severity prediction", "PASS", "risk_level", "—"),
    ("BR-AI-05", "AI Diagnosis", "Must Have", "Safe-to-drive recommendation", "PASS", "safe_to_drive UI", "—"),
    ("BR-AI-06", "AI Diagnosis", "Must Have", "Estimated repair cost", "PASS", "cost_min/max INR", "—"),
    ("BR-AI-07", "AI Diagnosis", "Must Have", "Estimated repair duration", "PASS", "repair_time_estimate", "—"),
    ("BR-AI-08", "AI Diagnosis", "Must Have", "Recommended next steps", "PASS", "recommended_steps + DIY", "—"),
    ("BR-AI-09", "AI Diagnosis", "Should Have", "Preventive maintenance suggestions", "PASS", "preventive_maintenance", "—"),
    ("BR-AI-10", "AI Diagnosis", "Should Have", "Follow-up questions when required", "PARTIAL", "Missing-field asks only", "No post-diagnosis follow-ups"),
    ("BR-UX-01", "UX", "Must Have", "Mobile-first design", "PARTIAL", "Responsive SCSS", "Not dedicated mobile shell"),
    ("BR-UX-02", "UX", "Must Have", "Progress indicators", "PASS", "Steps 1–3", "—"),
    ("BR-UX-03", "UX", "Must Have", "Conversation history", "PARTIAL", "In-session + API history", "No Angular history UI / conversation DB"),
    ("BR-UX-04", "UX", "Must Have", "Voice/Text switching", "PASS", "Mode selector Step 1", "—"),
    ("BR-UX-05", "UX", "Must Have", "Error handling", "PASS", "STT + diag error cards", "—"),
    ("BR-UX-06", "UX", "Should Have", "Offline handling", "PARTIAL", "clientFallback", "Web Speech needs network"),
    ("BR-SEC-01", "Security", "Must Have", "Microphone permissions", "PARTIAL", "Browser not-allowed string", "Android RECORD_AUDIO + consent UX"),
    ("BR-SEC-02", "Security", "Must Have", "Voice data encryption", "PARTIAL", "TLS assumed", "No recording at-rest design"),
    ("BR-SEC-03", "Security", "Must Have", "Secure storage", "PARTIAL", "Postgres + R2 images", "Transcripts not stored"),
    ("BR-SEC-04", "Security", "Must Have", "User consent for voice processing", "FAIL", "Generic privacy only", "No mic consent gate"),
    ("BR-SEC-05", "Security", "Must Have", "Delete recordings", "FAIL", "Nothing persisted", "Need retention + delete API"),
    ("BR-SEC-06", "Security", "Must Have", "Privacy compliance (DPDP)", "PARTIAL", "Disclaimer pages", "No diagnosis delete UX"),
    ("BR-PERF-01", "Performance", "Must Have", "Fast response time", "PARTIAL", "Fallback fast", "Ollama unbounded"),
    ("BR-PERF-02", "Performance", "Should Have", "High STT accuracy", "PARTIAL", "Browser STT + retry", "No benchmarks"),
    ("BR-PERF-03", "Performance", "Must Have", "High AI response accuracy", "PARTIAL", "KB+Ollama", "No golden-set tests"),
    ("BR-API-01", "API", "Must Have", "STT API", "FAIL", "Browser-only", "POST /diagnosis/stt needed"),
    ("BR-API-02", "API", "Must Have", "TTS API", "FAIL", "Browser-only", "Server TTS optional"),
    ("BR-API-03", "API", "Should Have", "Language detection API", "FAIL", "Client-only", "POST /diagnosis/detect-language"),
    ("BR-API-04", "API", "Should Have", "Translation API", "PARTIAL", "Internal translate", "Not standalone"),
    ("BR-API-05", "API", "Must Have", "AI Diagnosis API", "PASS", "POST /diagnosis/analyse", "—"),
    ("BR-API-06", "API", "Must Have", "Image upload API", "PASS", "POST /upload/image", "—"),
    ("BR-API-07", "API", "Must Have", "Audio upload API", "FAIL", "Missing", "POST /upload/audio"),
    ("BR-DB-01", "Database", "Must Have", "Voice transcript storage", "FAIL", "Missing", "voice_transcripts table"),
    ("BR-DB-02", "Database", "Must Have", "Conversation history storage", "FAIL", "In-memory only", "diagnosis_conversations"),
    ("BR-DB-03", "Database", "Must Have", "AI diagnosis history", "PASS", "vehicle_diagnoses", "Angular history UI gap"),
    ("BR-DB-04", "Database", "Should Have", "Audit logs", "FAIL", "Missing", "diagnosis_audit_events"),
    ("BR-TEST-01", "Quality", "Must Have", "Automated diagnosis tests", "FAIL", "No test_diagnosis.py", "Critical QA gap"),
    ("BR-AND-01", "Mobile", "Must Have", "Android RECORD_AUDIO permission", "FAIL", "Manifest gap for mic", "Add permission + plugin"),
]


def main() -> None:
    status_c = Counter(r[4] for r in REQS)
    weights = {"PASS": 1.0, "PARTIAL": 0.5, "FAIL": 0.0}
    score = round(100 * sum(weights[r[4]] for r in REQS) / len(REQS))

    tests: list[dict] = []

    def T(suite: str, tid: str, name: str, status: str, detail: str, sev: str = "—") -> None:
        tests.append(
            {"suite": suite, "id": tid, "name": name, "status": status, "detail": detail, "severity": sev}
        )

    T("Functional", "TC-F-01", "Manual Step1→4 diagnose path", "PASS", "Wizard + analyse API")
    T("Functional", "TC-F-02", "Voice language picker → capture vehicle", "PASS", "voice-mode flow")
    T("Functional", "TC-F-03", "Extract Hindi/Bengali/Tamil brands", "PASS", "multilingual extractor")
    T("Functional", "TC-F-04", "Missing field voice re-ask", "PASS", "_askMissingFields")
    T("Functional", "TC-F-05", "Warning lights + severity", "PASS", "Step 2 chips")
    T("Functional", "TC-F-06", "Image upload then analyse", "PASS", "upload + image_urls")
    T("Functional", "TC-F-07", "Report cost/safe-drive/steps/disclaimer", "PASS", "Report UI")
    T("Functional", "TC-F-08", "TTS play/pause/stop/replay", "PASS", "voice-diagnosis.service")
    T("Functional", "TC-F-09", "Client KB fallback when API down", "PASS", "clientFallback")
    T("Functional", "TC-F-10", "Auth history endpoint", "PASS", "GET /diagnosis/history")
    T("Functional", "TC-F-11", "IDOR blocked on GET diagnosis", "PASS", "MOB-007 owner check")
    T("Functional", "TC-F-12", "Upload audio recording", "FAIL", "No UI/API", "P0")
    T("Functional", "TC-F-13", "Upload video", "FAIL", "No UI/API", "P0")
    T("Functional", "TC-F-14", "Maintenance history entry", "FAIL", "Not implemented", "P1")
    T("Functional", "TC-F-15", "Auto language detect without picker", "FAIL", "autoDetect unwired", "P1")
    T("Functional", "TC-F-16", "Full prompt localization kn/ml/gu/pa/or", "FAIL", "PROMPTS only 6 langs", "P1")
    T("Functional", "TC-F-17", "Angular diagnosis history UI", "FAIL", "API only", "P1")
    T("Functional", "TC-F-18", "Server STT for WebView/Safari", "FAIL", "Browser STT only", "P0")
    T("Functional", "TC-F-19", "Mic consent before STT", "FAIL", "Missing", "P0")
    T("Functional", "TC-F-20", "Android RECORD_AUDIO declared", "FAIL", "Manifest gap", "P0")
    T("Functional", "TC-F-21", "Persist conversation transcripts", "FAIL", "No DB", "P1")
    T("Functional", "TC-F-22", "Delete voice data (DPDP)", "FAIL", "Missing", "P1")
    T("Functional", "TC-F-23", "Post-diagnosis follow-up questions", "FAIL", "Not in analyse", "P2")
    T("Functional", "TC-F-24", "Vector RAG for diagnosis KB", "FAIL", "Keyword only", "P2")
    T("Security", "TC-S-01", "Unauth GET diagnosis denied", "PASS", "owner auth")
    T("Security", "TC-S-02", "Prompt injection fencing", "PARTIAL", "User text in prompts", "P0")
    T("Security", "TC-S-03", "Rate limit analyse", "PASS", "documented limits")
    T("Security", "TC-S-04", "Audio upload validation", "FAIL", "No audio upload", "P1")
    T("Performance", "TC-P-01", "Analyse p95 with fallback", "PARTIAL", "Ollama unbounded", "P1")
    T("Performance", "TC-P-02", "STT works offline", "FAIL", "Web Speech needs net", "P1")
    T("A11y", "TC-A-01", "Voice overlay SR labels", "PARTIAL", "Audit incomplete", "P2")
    T("Mobile", "TC-M-01", "No horizontal overflow on route", "PASS", "mobile-layout e2e")
    T("Mobile", "TC-M-02", "Voice overlay one-handed", "PARTIAL", "No driving mode", "P2")
    T("Regression", "TC-R-01", "API pytest diagnosis suite", "FAIL", "No test_diagnosis.py", "P0")
    T("Regression", "TC-R-02", "Voice extractor unit tests", "FAIL", "No *.spec.ts", "P0")
    T("Integration", "TC-I-01", "Ollama down → heuristic report", "PASS", "fallback path")
    T("Integration", "TC-I-02", "Vision on image_url", "PARTIAL", "vision.py untested quality", "P2")
    T("Usability", "TC-U-01", "Manual vs Voice mode clear", "PASS", "Step 1 selector")
    T("Usability", "TC-U-02", "Disclaimer before submit", "PASS", "Step 3")

    tc = Counter(t["status"] for t in tests)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    req_rows = "\n".join(
        f"| {a} | {b} | {c} | {d} | **{e}** | {g} |" for a, b, c, d, e, _f, g in REQS
    )
    fail_tests = "\n".join(
        f"| {t['id']} | {t['status']} | {t['severity']} | {t['name']} — {t['detail']} |"
        for t in tests
        if t["status"] != "PASS"
    )

    brd = f"""# GAADIIQ — AI Diagnosis Module
## Business Requirements Document (BRD) + E2E QA Results

| Field | Value |
|-------|-------|
| Product | GAADIIQ AI Vehicle Preliminary Diagnosis |
| Version | 1.0 (implementation-ready) |
| Date | {now} |
| Code tip audited | `claude/gaadiiq-app-dev-abj5fo` (voice multilingual through latest tip) |
| Status | **Partial vs full BRD — NOT production-ready for complete voice+media scope** |

---

## 1. Business Overview

### 1.1 Business problem
Indian vehicle owners delay repairs due to language barriers, opaque workshop advice, and fear of overcharging. They need fast, trustworthy, **multilingual** preliminary diagnosis before visiting a garage.

### 1.2 Business objectives
1. Diagnose via **form or voice** in major Indian languages.
2. Return AI preliminary root cause, severity, safe-to-drive, cost/time, next steps.
3. Support images (and audio/video per BRD) for richer context.
4. Be mobile-first, private, and production-reliable on Android/iOS WebView.

### 1.3 Scope (in)
Manual + voice capture · multilingual STT/TTS · Ollama + KB diagnosis · image upload · history · disclaimers · service-centre CTA.

### 1.4 Out of scope (v1)
OBD-II · certified accuracy · full insurance claims · replacing mechanic inspection.

### 1.5 Assumptions
Mic permission granted for voice · Ollama available with fallback · browser STT OK for MVP; server STT for GA.

### 1.6 Dependencies
FastAPI diagnosis/upload · R2 media · Ollama + `repair_knowledge.json` · Capacitor mic/camera permissions.

---

## 2. User Personas

Individual Car Owner · First-time Driver · Non-English Speaker · Fleet Owner · Taxi Driver · Dealer · Service Advisor.

---

## 3. Business Requirements — coverage vs code

**{status_c.get('PASS', 0)} PASS / {status_c.get('PARTIAL', 0)} PARTIAL / {status_c.get('FAIL', 0)} FAIL** ({len(REQS)} requirements)  
**Weighted BRD readiness: {score}/100**

| ID | Area | Priority | Requirement | Status | Gap |
|----|------|----------|-------------|--------|-----|
{req_rows}

---

## 4. Non-Functional Requirements (targets)

| ID | Category | Target | Current |
|----|----------|--------|---------|
| NFR-P1 | Performance | Analyse p95 ≤ 5s (fallback ≤ 1s) | Fallback OK; Ollama unbounded |
| NFR-A1 | Availability | 99.5% via fallback | Heuristic fallback exists |
| NFR-S1 | Security | Consent before mic; authz on history | Authz OK; consent missing |
| NFR-S2 | Privacy | DPDP delete | Delete UX missing |
| NFR-T1 | Testability | API + unit + e2e | **FAIL — almost no tests** |

---

## 5. UI/UX Screens

| Screen | Present |
|--------|---------|
| Vehicle Details Form | Yes |
| Mode selector Manual/Voice | Yes |
| Voice Recording Overlay | Yes |
| Live transcription | Yes |
| AI Result + TTS controls | Yes |
| Conversation History UI | **Partial / weak** |
| Image upload | Yes |
| Audio/Video upload | **No** |
| Maintenance history | **No** |
| Mic consent gate | **No** |

---

## 6. Process Flows

**Manual:** `/vehicle-diagnosis` → vehicle → symptoms (+lights/photos) → review → analyse → report.  
**Voice:** language → TTS greeting → speak vehicle → extract → missing asks → speak problem → autofill → review → analyse (translate) → TTS report.  
**AI:** validate → optional vision → KB retrieve → Ollama/heuristic → translate → persist → disclaimer.  
**Errors:** STT denied/no-speech → retry; API fail → client fallback.

---

## 7. API Requirements

| API | Status |
|-----|--------|
| `POST /diagnosis/analyse` | Exists |
| `POST /diagnosis/voice/extract` | Exists |
| `GET /diagnosis/history` | Exists |
| `GET /diagnosis/{{id}}` | Exists (authz) |
| `POST /upload/image` | Exists |
| `POST /upload/audio` | **Missing** |
| `POST /diagnosis/stt` | **Missing** |
| `POST /diagnosis/tts` | **Missing** |
| `POST /diagnosis/detect-language` | **Missing** |

---

## 8. Database Impact

| Object | Action |
|--------|--------|
| `vehicle_diagnoses` | Keep; add maintenance_history; wire audio/video URLs |
| `diagnosis_conversations` | **Create** |
| `voice_transcripts` | **Create** (consent-gated) |
| `diagnosis_audit_events` | **Create** |

---

## 9. Business Rules

1. Problem text ≥ 10 chars or non-empty voice transcript.  
2. Images: jpeg/png/webp/heic; max 5.  
3. Audio (when built): ≤ 60s; consent required.  
4. Always show safety disclaimer; never claim certified diagnosis.  
5. `safe_to_drive=false` → prominent stop-driving warning.  
6. Response language = user language; English fallback with banner.  
7. Guest diagnose OK; history requires auth.  
8. Low confidence → follow-up questions or low-confidence banner.

---

## 10. Acceptance Criteria (selected)

### AC-BR-VI-02 Voice vehicle entry — **PASS**
Given `hi-IN` voice mode, when user speaks Maruti Swift 2019 petrol, then fields extract and TTS confirms.

### AC-BR-IR-04 Audio upload — **FAIL**
Given Step 2, when user uploads engine sound, then `audio_url` is stored — **not implemented**.

### AC-BR-ML-04 AI language match — **PARTIAL**
Given `ta-IN`, when analyse completes, then report is Tamil or fallback banner — translation helper exists, quality unproven.

### AC-BR-SEC-04 Mic consent — **FAIL**
Given first voice use, when Use Voice tapped, then consent precedes STT — **missing**.

### AC-BR-API-01 Production STT — **FAIL**
Given WebView without Web Speech, when voice used, then server STT works — **missing**.

---

## 11. Test Scenarios & Results

| Metric | Value |
|--------|------:|
| Scenarios | {len(tests)} |
| PASS | {tc.get('PASS', 0)} |
| PARTIAL | {tc.get('PARTIAL', 0)} |
| FAIL | {tc.get('FAIL', 0)} |
| BRD readiness | **{score}/100** |
| Verdict | **NO-GO** full BRD; **Conditional Go** manual+image MVP |

### Non-PASS scenarios

| ID | Status | Severity | Detail |
|----|--------|----------|--------|
{fail_tests}

---

## 12. Risks and Mitigation

| Risk | Mitigation |
|------|------------|
| WebView STT dead | Server STT + Capacitor mic |
| LLM wrong safe-to-drive | Disclaimer + conservative prompts |
| No tests | `test_diagnosis.py` + extractor specs |
| Voice without consent | Consent gate + DPDP delete |
| Thin KB (12 cases) | Expand + embedding RAG |

---

## 13. Future Enhancements
OBD-II · predictive maintenance · telemetry · service booking · insurance assist · dealer CRM · reminders.

---

## 14. Production Readiness Verdict

| Scope | Verdict |
|-------|---------|
| Manual + images + AI report | Near-ready (add tests) |
| Browser multilingual voice | Beta (consent, Android mic, prompts) |
| Full BRD | **NO-GO** |

**Overall BRD readiness: {score}/100.**

Claude prompts: `Claude_Fix_Prompts_Diagnosis_BRD.md`
"""

    (QA / "GAADIIQ_AI_Diagnosis_BRD_and_QA.md").write_text(brd)
    (ART / "GAADIIQ_AI_Diagnosis_BRD_and_QA.md").write_text(brd)

    catalog = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "brd_readiness_score": score,
        "requirement_counts": dict(status_c),
        "test_counts": dict(tc),
        "recommendation": "NO-GO for full BRD; CONDITIONAL for manual+image MVP",
        "requirements": [
            {
                "id": a,
                "area": b,
                "priority": c,
                "requirement": d,
                "status": e,
                "evidence": f,
                "gap": g,
            }
            for a, b, c, d, e, f, g in REQS
        ],
        "tests": tests,
    }
    (QA / "diagnosis-brd-qa.json").write_text(json.dumps(catalog, indent=2))
    (ART / "diagnosis-brd-qa.json").write_text(json.dumps(catalog, indent=2))

    with (QA / "diagnosis-requirements.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "area", "priority", "requirement", "status", "evidence", "gap"])
        w.writerows(REQS)

    prompts = f"""# Claude Code Fix Prompts — AI Diagnosis BRD Gaps

Source: `docs/qa/diagnosis/GAADIIQ_AI_Diagnosis_BRD_and_QA.md`  
BRD readiness: **{score}/100**

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
Read docs/qa/diagnosis/GAADIIQ_AI_Diagnosis_BRD_and_QA.md requirement {{REQ_ID}}.
Implement ONLY {{REQ_ID}}. Add tests. Do not regress voice multilingual extract or disclaimer.
```
"""
    (QA / "Claude_Fix_Prompts_Diagnosis_BRD.md").write_text(prompts)
    (ART / "Claude_Fix_Prompts_Diagnosis_BRD.md").write_text(prompts)

    summary = f"""# AI Diagnosis — E2E Test Architect Summary

**Date:** {now}  
**BRD readiness:** **{score}/100**  
**Requirements:** {status_c.get('PASS', 0)} PASS / {status_c.get('PARTIAL', 0)} PARTIAL / {status_c.get('FAIL', 0)} FAIL  
**Test scenarios:** {tc.get('PASS', 0)} PASS / {tc.get('PARTIAL', 0)} PARTIAL / {tc.get('FAIL', 0)} FAIL  

**Verdict:** **NO-GO** for full BRD (server STT/TTS, audio/video, consent, DPDP, tests).  
**Conditional Go** for manual form + images + AI report with disclaimer.

## Top Claude priorities
1. Mic consent + Android RECORD_AUDIO  
2. Server STT fallback for WebView  
3. Audio upload  
4. `test_diagnosis.py` + extractor unit tests  
5. History UI + transcript DB + delete  
6. Auto language detect + full prompt localization  

## Files
- `GAADIIQ_AI_Diagnosis_BRD_and_QA.md`
- `Claude_Fix_Prompts_Diagnosis_BRD.md`
- `diagnosis-brd-qa.json`
- `GAADIIQ_AI_Diagnosis_BRD_QA.xlsx`
"""
    (QA / "AI_Diagnosis_E2E_Summary.md").write_text(summary)
    (ART / "AI_Diagnosis_E2E_Summary.md").write_text(summary)

    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill

        wb = Workbook()
        ws = wb.active
        ws.title = "Executive"
        for row in [
            ["GAADIIQ AI Diagnosis BRD QA"],
            ["Generated", now],
            ["BRD Score", score],
            ["Req PASS", status_c.get("PASS", 0)],
            ["Req PARTIAL", status_c.get("PARTIAL", 0)],
            ["Req FAIL", status_c.get("FAIL", 0)],
            ["Test PASS", tc.get("PASS", 0)],
            ["Test PARTIAL", tc.get("PARTIAL", 0)],
            ["Test FAIL", tc.get("FAIL", 0)],
            ["Recommendation", catalog["recommendation"]],
        ]:
            ws.append(row)
        ws["A1"].font = Font(bold=True, size=14)

        fills = {
            "PASS": PatternFill("solid", "C6EFCE"),
            "PARTIAL": PatternFill("solid", "FFEB9C"),
            "FAIL": PatternFill("solid", "FFC7CE"),
        }
        wr = wb.create_sheet("Requirements")
        wr.append(["ID", "Area", "Priority", "Requirement", "Status", "Evidence", "Gap"])
        for r in REQS:
            wr.append(list(r))
            wr.cell(wr.max_row, 5).fill = fills[r[4]]

        wt = wb.create_sheet("TestCases")
        wt.append(["Suite", "ID", "Name", "Status", "Severity", "Detail"])
        for t in tests:
            wt.append([t["suite"], t["id"], t["name"], t["status"], t["severity"], t["detail"]])
            wt.cell(wt.max_row, 4).fill = fills.get(t["status"], PatternFill())

        out = QA / "GAADIIQ_AI_Diagnosis_BRD_QA.xlsx"
        wb.save(out)
        (ART / "GAADIIQ_AI_Diagnosis_BRD_QA.xlsx").write_bytes(out.read_bytes())
        print("xlsx", out)
    except Exception as e:
        print("xlsx", e)

    print(
        json.dumps(
            {
                "score": score,
                "reqs": dict(status_c),
                "tests": dict(tc),
                "n_reqs": len(REQS),
                "n_tests": len(tests),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
