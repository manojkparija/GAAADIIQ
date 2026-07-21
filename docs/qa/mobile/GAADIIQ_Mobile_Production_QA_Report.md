# GAADIIQ Mobile Production QA Report

**Application:** GAADIIQ — AI Automotive Intelligence (India)  
**Platforms audited:** Android (Capacitor WebView), iOS (**absent**), Angular PWA  
**Code tip:** `claude/gaadiiq-app-dev-abj5fo` (includes Android icon + Used Cars / Diagnosis work)  
**Report date:** 2026-07-21 07:03 UTC  
**Roles:** Principal Mobile Test Architect · QA Lead · Security · Performance · Accessibility · AI Testing · Product Owner  

---

## 1. Executive Summary

GAADIIQ’s mobile surface is a **Capacitor Android WebView wrapping an Angular SPA**, not a native feature-complete Android/iOS product. Core marketplace browsing, login/register, used/new cars, compare, EMI, and AI diagnosis **exist**. Production mobile release is **blocked** by missing iOS, dual auth (Supabase vs FastAPI JWT), absent payment checkout, missing OTP/push/native plugins, diagnosis IDOR, LLM prompt-injection exposure, and near-zero automated mobile tests.

**Recommendation: NO-GO for production mobile release.**

| Score | Value |
|------|------:|
| Production Readiness | **22/100** |
| Overall Quality | **48/100** |
| Requested Feature Coverage (weighted) | **50%** |

---

## 2. Methodology & Limits

| Method | Scope |
|--------|--------|
| Static architecture & code review | Capacitor, AndroidManifest, Angular routes/services, FastAPI, AI services, migrations |
| Prior automated matrices | Used Cars, Diagnosis, New Cars, Advisor under `docs/qa/` |
| Physical devices / Appium / battery / FPS | **NOT EXECUTED** here — residual risk |
| Full pen-test | Code-level review only |

Features not evidenced in the repo are **FAIL / MISSING**, never assumed PASS.

---

## 3. Test Coverage

| Layer | Coverage | Notes |
|-------|----------:|-------|
| Feature checklist (36 items) | **50%** weighted | 11 PASS / 14 PARTIAL / 11 FAIL |
| Angular unit tests | **~0%** | 1 broken boilerplate spec |
| API pytest | **~55%** of routers | diagnosis/recommend/upload gaps |
| Mobile E2E (Appium) | **0%** | Not present |
| Accessibility WCAG | **~10%** | Static spot check |
| Performance device lab | **0%** | Not measured |

**Mission checklist rigorously covered: ~35–40%; remainder blocked by missing device lab / instrumentation.**

---

## 4. Features Tested

| Feature | Result | Evidence note |
|---------|--------|---------------|
| Registration | **PARTIAL** | Email/password+OAuth; phone unused; no OTP |
| Login | **PASS** | Supabase email/password + Google/Facebook |
| OTP | **FAIL** | Not implemented |
| Password Reset | **PASS** | resetPasswordForEmail + /reset-password |
| Dashboard | **PARTIAL** | Home marketplace, not full role dashboards |
| Vehicle Search | **PASS** | Listings/search UI |
| Compare Cars | **PASS** | Client compare |
| Car Details | **PASS** | /cars/:id |
| Used Cars | **PASS** | Filters + inventory (P0 fixed on tip) |
| AI Recommendation | **PARTIAL** | Quiz heuristic; not API /recommend |
| Dealer Search | **FAIL** | No directory |
| Dealer Dashboard | **PASS** | sellerGuard route |
| Test Drive Booking | **PARTIAL** | Page exists; Supabase-backed |
| Loan Calculator | **PASS** | Client EMI |
| Insurance | **FAIL** | No partner flow |
| EMI Calculator | **PASS** | /emi-calculator |
| TCO Calculator | **PARTIAL** | Service/Next; weak mobile entry |
| EV Calculator | **FAIL** | Missing |
| AI Vehicle Diagnosis | **PASS** | Wizard + API + fallback |
| Customer Sentiment | **PARTIAL** | Dealer API only |
| AI Chat | **FAIL** | Not implemented |
| Vehicle Image Upload | **PARTIAL** | Cloudinary list-car; diagnosis API upload |
| Audio Upload | **FAIL** | Missing |
| Video Upload | **FAIL** | Missing |
| Document Upload | **FAIL** | Missing |
| Wishlist | **PARTIAL** | localStorage |
| Notifications | **PARTIAL** | API exists; no push; auth mismatch |
| User Profile | **PARTIAL** | Thin |
| Settings | **PARTIAL** | Theme/lang only |
| Service Booking | **PARTIAL** | Maps to static centres |
| Service History | **FAIL** | Missing |
| Review System | **PARTIAL** | Mixed local/API |
| Payment Flow | **FAIL** | No mobile checkout |
| Logout | **PASS** | Supabase signOut |
| Android | **PARTIAL** | WebView shell only |
| iOS | **FAIL** | No project |

**Totals:** 11 PASS · 14 PARTIAL · 11 FAIL

---

## 5–6. Issue Counts

Issues logged: **40**

| Severity | Count |
|----------|------:|
| BLOCKER | 4 |
| CRITICAL | 8 |
| HIGH | 10 |
| MEDIUM | 11 |
| LOW | 7 |

---

## 7. Blockers

- **MOB-001**: No iOS Capacitor project exists; only Android WebView shell under apps/gaadiiq-angular/android.
- **MOB-002**: Dual auth stacks: Angular uses Supabase Auth; FastAPI uses RS256 JWT. Mobile UI does not obtain FastAPI tokens, so many API routes (payments, loans inquiries, notifications, diagnosis history) are unreachable or broken from the app.
- **MOB-003**: No Razorpay checkout wired in Angular despite API /payments/* and marketing copy claiming UPI/cards/EMI via Razorpay.
- **MOB-004**: Capacitor app is a bare WebView wrap: no Camera, Geolocation, Push, Preferences, or Filesystem plugins; package.json has no cap sync/run scripts.

---

## 8–11. Critical / High / Medium / Low

### CRITICAL
- **MOB-005** [Security] AndroidManifest: android:allowBackup="true" allows ADB backup of WebView data including localStorage (wishlist, journey, possibly session fragments).
- **MOB-006** [Security] Network: No SSL/certificate pinning and no Network Security Config; MITM on user devices possible for API/Supabase traffic.
- **MOB-007** [Security] AI Diagnosis API: GET /diagnosis/{id} is unauthenticated → IDOR: anyone with UUID can read another user's diagnosis (vehicle + symptoms).
- **MOB-008** [AI/Security] AI modules: User-controlled text interpolated into LLM prompts with no sanitisation/injection fence — prompt injection risk; HLD claims sanitisation but code lacks it.
- **MOB-009** [Missing Feature] Registration / Login: OTP / phone SMS authentication does not exist. Register may collect phone but AuthService.register() never uses verifyOtp.
- **MOB-010** [Security/Mobile] City / Diagnosis geolocation: App uses navigator.geolocation but AndroidManifest declares only INTERNET — no ACCESS_FINE_LOCATION / COARSE.
- **MOB-011** [API] API calls: ApiService.submitLoanInquiry hits /loans/inquiry but API exposes /loans/inquiries — broken loan lead capture.
- **MOB-012** [Security] Dealer/Admin: sellerGuard is client-side only. FastAPI dealer endpoints use soft Dealer-row checks; any user can POST /dealers/register. Role enums diverge (seller vs dealer).

### HIGH
- **MOB-013** [Missing Feature] Insurance: No insurance enquiry API or partner quote flow; only client-side premium estimates / marketing.
- **MOB-014** [Missing Feature / AI] AI Chat: Ask GAADIIQ / POST /recommend/ai-chat (SSE) from LLD is not implemented.
- **MOB-015** [Missing Feature] Push Notifications: No FCM/APNs Capacitor push plugin; in-app notifications API unused by primary Supabase auth path.
- **MOB-016** [AI] /ai-advisor: Angular advisor uses local heuristic scoring; not wired to POST /recommend. Diverges from Next.js advisor.
- **MOB-017** [Reliability] Wishlist / Price Alerts / Reviews: Wishlist, price alerts, recently viewed persist only in localStorage — lost on reinstall, not cross-device.
- **MOB-018** [Security] List Car / Diagnosis: Audio/video/document upload unsupported. List-car uses Cloudinary unsigned preset (abuse risk). Upload MIME allowlist only; vision may fetch arbitrary image_urls (SSRF).
- **MOB-019** [Security/Performance] API: SlowAPI rate limits disabled unless environment==production; diagnosis/analyse not limited; /metrics public.
- **MOB-020** [Database] Intent / Diagnosis models: customer_activities/intent_scores FK columns String(36) vs UUID PKs; vehicle_diagnoses.user_id nullable without FK.
- **MOB-021** [API] API: Default allowed_origins is localhost:3000; Capacitor/Android and Angular :4200 may be blocked against production API.
- **MOB-022** [Quality] Mobile QA: Only 1 Angular unit spec (boilerplate broken); no Appium/Detox against Capacitor; Android instrumented tests still Capacitor sample package names.

### MEDIUM
- **MOB-023** [UI/UX] Used Cars Budget Slider: Dual-range slider: WebKit thumb misalignment (no margin-top), no z-index swap when thumbs overlap, track not clickable.
- **MOB-024** [UI/UX] Used Cars: showAllIndiaBanner requires !allIndiaOverride so amber banner never shows after auto-override for empty cities.
- **MOB-025** [Functional] New Cars: New Cars P0 fixes (Above ₹30L applyBudget) live on cursor/fix-new-cars-module-85e1 and are NOT merged into Claude tip.
- **MOB-026** [Missing Feature] EV / TCO: No dedicated EV calculator screen; TCO service exists but weak mobile discovery.
- **MOB-027** [Missing Feature] Dealer Search / Service History: No dealer directory search; service booking only opens maps to static SERVICE_CENTERS; no service history.
- **MOB-028** [Accessibility] Global: Sparse ARIA; many outline:none without :focus-visible; no TalkBack/VoiceOver pass; contrast not systematically verified.
- **MOB-029** [Performance] Listings / Images: Listing grids without virtual scroll; no measured startup/FPS/memory on device.
- **MOB-030** [Reliability] Global: No true offline mode; SW precaches shell only; forms fail opaquely offline; no queue/retry.
- **MOB-031** [Business Rules] EMI Calculator: Bank rates are hardcoded stubs; client EMI not using GET /loans/emi-calculator.
- **MOB-032** [Security/Privacy] Dealer Dashboard: Public sentiment track endpoint forgeable; no customer consent UX.
- **MOB-033** [Compatibility] Devices: minSdk 24 but product asks Android 12+ validation; foldable/tablet/landscape untested; no iPad.

### LOW
- **MOB-034** [Quality] Android tests: Instrumented tests still reference com.getcapacitor.myapp / ExampleUnitTest.
- **MOB-035** [UI/UX] Used Cars empty state: No AI Advisor CTA when filters yield 0 results; no URL write-back for filters.
- **MOB-036** [Functional] History: API /diagnosis/history exists but Angular wizard has no history UI.
- **MOB-037** [Security] Root/Jailbreak: No root/jailbreak detection or Play Integrity on release builds.
- **MOB-038** [Maintainability] Environments: .env.example documents HS256 SECRET_KEY while API uses RS256 PEMs.
- **MOB-039** [Security] API: When Razorpay keys unset, webhook verification may be open — dangerous if mis-deployed.
- **MOB-040** [Missing Feature] Settings: No dedicated Settings/Profile edit screen; no DPDP delete-account flow.


---

## 11. Security Vulnerabilities (highlights)

| ID | Issue |
|----|-------|
| MOB-002 | Dual auth / token non-interoperability |
| MOB-005 | `allowBackup=true` |
| MOB-006 | No SSL pinning |
| MOB-007 | Diagnosis IDOR |
| MOB-008 | LLM prompt injection |
| MOB-010 | Location without manifest permission |
| MOB-012 | Weak/inconsistent RBAC |
| MOB-018 | Upload/SSRF/Cloudinary unsigned risks |
| MOB-019 | Rate limits off outside prod; public metrics |
| MOB-032 | Forgeable public sentiment track |
| MOB-039 | Payment webhook fail-open risk |

---

## 12. Performance Bottlenecks

- Device FPS/memory/battery **unmeasured** (lab required).
- Listing grids lack virtualization (MOB-029).
- Cloudinary/full-size images risk on slow networks.
- Diagnosis LLM latency unbounded; client fallback helps UX only.
- Rate limiter disabled in non-prod hides soak issues.

---

## 13. UI/UX Problems

- Budget dual-slider polish (MOB-023); All-India banner logic (MOB-024).
- Empty states missing Advisor CTA (MOB-035).
- New Cars budget UX vs unmerged fix branch (MOB-025).
- Thin settings/profile (MOB-040).
- Heuristic advisor over-claims “AI” (MOB-016).

---

## 14. Accessibility Issues

- Insufficient ARIA/landmarks (MOB-028).
- `outline: none` without consistent `:focus-visible`.
- No documented TalkBack/VoiceOver pass.
- Large font / dynamic type reflow unverified.
- Dark-mode contrast needs token audit.

---

## 15. AI Validation Issues

| Topic | Finding |
|-------|---------|
| Recommendation | Client heuristic ≠ API |
| Diagnosis | Works + KB fallback; history UI missing |
| Sentiment | Dealer-only; public track forgeable |
| Chat / RAG | Chat missing; Ollama without injection defenses |
| Hallucination / confidence | Partial method badges; advisor weak |
| Prompt injection | **FAIL** (MOB-008) |

---

## 16. Missing Features

iOS · OTP · Push · Payment checkout · Insurance · AI Chat · EV calculator · Dealer search · Service history · Audio/Video/Document upload · Root detection · SSL pinning · Native camera/geo plugins · DPDP delete-account

---

## 17. Risk Assessment

| Risk | Likelihood | Impact | Priority |
|------|------------|--------|----------|
| Auth dual-stack breaks paid/API flows | High | Critical | P0 |
| Diagnosis IDOR / backup leakage | Medium | Critical | P0 |
| Prompt injection brand/legal harm | Medium | High | P0 |
| WebView marketed as native app | High | High | P0 |
| Webhook misconfig / payment fraud | Medium | Critical | P0 |
| Play/App Store rejection | High | High | P0 |
| A11y non-compliance | Medium | Medium | P1 |

---

## 18–19. Scores

| Metric | Score |
|--------|------:|
| Production Readiness | **22/100** |
| Overall Quality | **48/100** |

---

## 20. Go / No-Go

# **NO-GO**

Minimum before any store release:

1. MOB-002 dual auth  
2. MOB-005–007 backup + pinning + IDOR  
3. MOB-003 payments or remove claims  
4. MOB-001 iOS or explicit Android-only beta labeling  
5. MOB-004 / MOB-010 native plugins + permissions  
6. MOB-008 prompt-injection defenses  
7. MOB-022 critical-path mobile automation  

**Interim OK:** internal Android **Tech Preview** (WebView), payments disabled, P0 security fixes applied.

---

## Appendix — Architecture truth

```
Angular SPA (apps/gaadiiq-angular)
  └─ Capacitor 8 Android WebView (com.gaadiiq.app) — INTERNET only
  └─ Supabase Auth + Cloudinary + optional FastAPI
FastAPI (apps/api) — separate JWT world
Next.js (apps/web) — parallel web
iOS — does not exist
```

Fix prompts: `Claude_Fix_Prompts.md` · Machine catalog: `Issues_Catalog.json`
