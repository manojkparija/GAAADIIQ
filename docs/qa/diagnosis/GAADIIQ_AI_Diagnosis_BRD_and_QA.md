# GAADIIQ — AI Diagnosis Module
## Business Requirements Document (BRD) + E2E QA Results

| Field | Value |
|-------|-------|
| Product | GAADIIQ AI Vehicle Preliminary Diagnosis |
| Version | 1.0 (implementation-ready) |
| Date | 2026-07-25 13:53 UTC |
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

**31 PASS / 19 PARTIAL / 14 FAIL** (64 requirements)  
**Weighted BRD readiness: 63/100**

| ID | Area | Priority | Requirement | Status | Gap |
|----|------|----------|-------------|--------|-----|
| BR-VI-01 | Vehicle Info | Must Have | Manual vehicle information entry | **PASS** | — |
| BR-VI-02 | Vehicle Info | Must Have | Voice-based vehicle information entry | **PASS** | — |
| BR-VI-03 | Vehicle Info | Must Have | Auto-extract vehicle details from speech | **PASS** | — |
| BR-VI-04 | Vehicle Info | Must Have | Auto-fill of vehicle information | **PASS** | — |
| BR-VI-05 | Vehicle Info | Must Have | Intelligent validation | **PASS** | — |
| BR-VI-06 | Vehicle Info | Must Have | Missing information prompts | **PASS** | — |
| BR-IR-01 | Issue Reporting | Must Have | Report issue using text | **PASS** | — |
| BR-IR-02 | Issue Reporting | Must Have | Report issue using voice | **PASS** | — |
| BR-IR-03 | Issue Reporting | Must Have | Upload vehicle images | **PASS** | — |
| BR-IR-04 | Issue Reporting | Must Have | Upload audio recordings | **FAIL** | No UI/API upload |
| BR-IR-05 | Issue Reporting | Must Have | Upload videos | **FAIL** | No video upload |
| BR-IR-06 | Issue Reporting | Must Have | Select dashboard warning lights | **PASS** | — |
| BR-IR-07 | Issue Reporting | Should Have | Add maintenance history | **FAIL** | No maintenance_history field |
| BR-ML-01 | Multilingual | Must Have | Automatic language detection | **PARTIAL** | Wire autoDetect into voice session |
| BR-ML-02 | Multilingual | Must Have | Support major Indian languages | **PASS** | Prompts fully localized for 6 only |
| BR-ML-03 | Multilingual | Must Have | Preserve user language in conversation | **PASS** | — |
| BR-ML-04 | Multilingual | Must Have | AI responses match user language | **PARTIAL** | Quality untested; may stay EN |
| BR-VA-01 | Voice AI | Must Have | Speech-to-Text | **PARTIAL** | No server STT; WebView risk |
| BR-VA-02 | Voice AI | Must Have | Text-to-Speech | **PARTIAL** | No server TTS |
| BR-VA-03 | Voice AI | Must Have | Live transcription | **PASS** | — |
| BR-VA-04 | Voice AI | Should Have | Voice playback | **PASS** | — |
| BR-VA-05 | Voice AI | Should Have | Replay | **PASS** | — |
| BR-VA-06 | Voice AI | Should Have | Pause | **PASS** | — |
| BR-VA-07 | Voice AI | Should Have | Stop | **PASS** | — |
| BR-VA-08 | Voice AI | Should Have | Hands-free mode | **PARTIAL** | No always-on driving mode |
| BR-VA-09 | Voice AI | Should Have | Driver-friendly interaction | **PARTIAL** | No driving mode; RECORD_AUDIO gap |
| BR-AI-01 | AI Diagnosis | Must Have | Ollama LLM integration | **PASS** | — |
| BR-AI-02 | AI Diagnosis | Must Have | RAG knowledge base | **PARTIAL** | Not vector RAG for diagnosis |
| BR-AI-03 | AI Diagnosis | Must Have | Root cause prediction | **PASS** | — |
| BR-AI-04 | AI Diagnosis | Must Have | Severity prediction | **PASS** | — |
| BR-AI-05 | AI Diagnosis | Must Have | Safe-to-drive recommendation | **PASS** | — |
| BR-AI-06 | AI Diagnosis | Must Have | Estimated repair cost | **PASS** | — |
| BR-AI-07 | AI Diagnosis | Must Have | Estimated repair duration | **PASS** | — |
| BR-AI-08 | AI Diagnosis | Must Have | Recommended next steps | **PASS** | — |
| BR-AI-09 | AI Diagnosis | Should Have | Preventive maintenance suggestions | **PASS** | — |
| BR-AI-10 | AI Diagnosis | Should Have | Follow-up questions when required | **PARTIAL** | No post-diagnosis follow-ups |
| BR-UX-01 | UX | Must Have | Mobile-first design | **PARTIAL** | Not dedicated mobile shell |
| BR-UX-02 | UX | Must Have | Progress indicators | **PASS** | — |
| BR-UX-03 | UX | Must Have | Conversation history | **PARTIAL** | No Angular history UI / conversation DB |
| BR-UX-04 | UX | Must Have | Voice/Text switching | **PASS** | — |
| BR-UX-05 | UX | Must Have | Error handling | **PASS** | — |
| BR-UX-06 | UX | Should Have | Offline handling | **PARTIAL** | Web Speech needs network |
| BR-SEC-01 | Security | Must Have | Microphone permissions | **PARTIAL** | Android RECORD_AUDIO + consent UX |
| BR-SEC-02 | Security | Must Have | Voice data encryption | **PARTIAL** | No recording at-rest design |
| BR-SEC-03 | Security | Must Have | Secure storage | **PARTIAL** | Transcripts not stored |
| BR-SEC-04 | Security | Must Have | User consent for voice processing | **FAIL** | No mic consent gate |
| BR-SEC-05 | Security | Must Have | Delete recordings | **FAIL** | Need retention + delete API |
| BR-SEC-06 | Security | Must Have | Privacy compliance (DPDP) | **PARTIAL** | No diagnosis delete UX |
| BR-PERF-01 | Performance | Must Have | Fast response time | **PARTIAL** | Ollama unbounded |
| BR-PERF-02 | Performance | Should Have | High STT accuracy | **PARTIAL** | No benchmarks |
| BR-PERF-03 | Performance | Must Have | High AI response accuracy | **PARTIAL** | No golden-set tests |
| BR-API-01 | API | Must Have | STT API | **FAIL** | POST /diagnosis/stt needed |
| BR-API-02 | API | Must Have | TTS API | **FAIL** | Server TTS optional |
| BR-API-03 | API | Should Have | Language detection API | **FAIL** | POST /diagnosis/detect-language |
| BR-API-04 | API | Should Have | Translation API | **PARTIAL** | Not standalone |
| BR-API-05 | API | Must Have | AI Diagnosis API | **PASS** | — |
| BR-API-06 | API | Must Have | Image upload API | **PASS** | — |
| BR-API-07 | API | Must Have | Audio upload API | **FAIL** | POST /upload/audio |
| BR-DB-01 | Database | Must Have | Voice transcript storage | **FAIL** | voice_transcripts table |
| BR-DB-02 | Database | Must Have | Conversation history storage | **FAIL** | diagnosis_conversations |
| BR-DB-03 | Database | Must Have | AI diagnosis history | **PASS** | Angular history UI gap |
| BR-DB-04 | Database | Should Have | Audit logs | **FAIL** | diagnosis_audit_events |
| BR-TEST-01 | Quality | Must Have | Automated diagnosis tests | **FAIL** | Critical QA gap |
| BR-AND-01 | Mobile | Must Have | Android RECORD_AUDIO permission | **FAIL** | Add permission + plugin |

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
| `GET /diagnosis/{id}` | Exists (authz) |
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
| Scenarios | 39 |
| PASS | 17 |
| PARTIAL | 5 |
| FAIL | 17 |
| BRD readiness | **63/100** |
| Verdict | **NO-GO** full BRD; **Conditional Go** manual+image MVP |

### Non-PASS scenarios

| ID | Status | Severity | Detail |
|----|--------|----------|--------|
| TC-F-12 | FAIL | P0 | Upload audio recording — No UI/API |
| TC-F-13 | FAIL | P0 | Upload video — No UI/API |
| TC-F-14 | FAIL | P1 | Maintenance history entry — Not implemented |
| TC-F-15 | FAIL | P1 | Auto language detect without picker — autoDetect unwired |
| TC-F-16 | FAIL | P1 | Full prompt localization kn/ml/gu/pa/or — PROMPTS only 6 langs |
| TC-F-17 | FAIL | P1 | Angular diagnosis history UI — API only |
| TC-F-18 | FAIL | P0 | Server STT for WebView/Safari — Browser STT only |
| TC-F-19 | FAIL | P0 | Mic consent before STT — Missing |
| TC-F-20 | FAIL | P0 | Android RECORD_AUDIO declared — Manifest gap |
| TC-F-21 | FAIL | P1 | Persist conversation transcripts — No DB |
| TC-F-22 | FAIL | P1 | Delete voice data (DPDP) — Missing |
| TC-F-23 | FAIL | P2 | Post-diagnosis follow-up questions — Not in analyse |
| TC-F-24 | FAIL | P2 | Vector RAG for diagnosis KB — Keyword only |
| TC-S-02 | PARTIAL | P0 | Prompt injection fencing — User text in prompts |
| TC-S-04 | FAIL | P1 | Audio upload validation — No audio upload |
| TC-P-01 | PARTIAL | P1 | Analyse p95 with fallback — Ollama unbounded |
| TC-P-02 | FAIL | P1 | STT works offline — Web Speech needs net |
| TC-A-01 | PARTIAL | P2 | Voice overlay SR labels — Audit incomplete |
| TC-M-02 | PARTIAL | P2 | Voice overlay one-handed — No driving mode |
| TC-R-01 | FAIL | P0 | API pytest diagnosis suite — No test_diagnosis.py |
| TC-R-02 | FAIL | P0 | Voice extractor unit tests — No *.spec.ts |
| TC-I-02 | PARTIAL | P2 | Vision on image_url — vision.py untested quality |

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

**Overall BRD readiness: 63/100.**

Claude prompts: `Claude_Fix_Prompts_Diagnosis_BRD.md`
