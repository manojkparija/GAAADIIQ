# Claude Code Fix Prompts — GAADIIQ Mobile QA Issues

Source report: `docs/qa/mobile/GAADIIQ_Mobile_Production_QA_Report.md`

Each section is a standalone implementation task.


---

## MOB-001 — BLOCKER — iOS

**Issue ID:** MOB-001  
**Severity:** BLOCKER  
**Affected Screen:** iOS  
**Category:** Missing Feature  
**Area:** Platform  

**Problem:**  
No iOS Capacitor project exists; only Android WebView shell under apps/gaadiiq-angular/android.

**Root Cause:**  
Product scoped Android-only scaffold; ios/ directory never created.

**Expected Behaviour:**  
Parity iOS app (Xcode project) with same Capacitor webDir and App Store readiness.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-001 (BLOCKER).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: No iOS Capacitor project exists; only Android WebView shell under apps/gaadiiq-angular/android.
- Root cause: Product scoped Android-only scaffold; ios/ directory never created.
- Expected: Parity iOS app (Xcode project) with same Capacitor webDir and App Store readiness.

PRIMARY FILES
- apps/gaadiiq-angular/capacitor.config.ts, apps/gaadiiq-angular/package.json
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-001.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-001 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-002 — BLOCKER — Auth (all)

**Issue ID:** MOB-002  
**Severity:** BLOCKER  
**Affected Screen:** Auth (all)  
**Category:** Security/Architecture  
**Area:** Architecture  

**Problem:**  
Dual auth stacks: Angular uses Supabase Auth; FastAPI uses RS256 JWT. Mobile UI does not obtain FastAPI tokens, so many API routes (payments, loans inquiries, notifications, diagnosis history) are unreachable or broken from the app.

**Root Cause:**  
Two parallel backends evolved without a unified session bridge.

**Expected Behaviour:**  
Single identity: either Supabase JWT validated by API, or mobile uses FastAPI login and stores secure tokens.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-002 (BLOCKER).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: Dual auth stacks: Angular uses Supabase Auth; FastAPI uses RS256 JWT. Mobile UI does not obtain FastAPI tokens, so many API routes (payments, loans inquiries, notifications, diagnosis history) are unreachable or broken from the app.
- Root cause: Two parallel backends evolved without a unified session bridge.
- Expected: Single identity: either Supabase JWT validated by API, or mobile uses FastAPI login and stores secure tokens.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/services/auth.service.ts, apps/api/core/security.py, apps/gaadiiq-angular/src/app/services/api.service.ts
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-002.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-002 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-003 — BLOCKER — Pricing Plans / Feature Listing

**Issue ID:** MOB-003  
**Severity:** BLOCKER  
**Affected Screen:** Pricing Plans / Feature Listing  
**Category:** Missing Feature  
**Area:** Payments  

**Problem:**  
No Razorpay checkout wired in Angular despite API /payments/* and marketing copy claiming UPI/cards/EMI via Razorpay.

**Root Cause:**  
Payments implemented server-side only; pricing-plans is FAQ/static.

**Expected Behaviour:**  
End-to-end checkout: create order → Razorpay SDK → verify → unlock plan/listing.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-003 (BLOCKER).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: No Razorpay checkout wired in Angular despite API /payments/* and marketing copy claiming UPI/cards/EMI via Razorpay.
- Root cause: Payments implemented server-side only; pricing-plans is FAQ/static.
- Expected: End-to-end checkout: create order → Razorpay SDK → verify → unlock plan/listing.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/pages/pricing-plans/, apps/api/routers/payments.py
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-003.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-003 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-004 — BLOCKER — App shell

**Issue ID:** MOB-004  
**Severity:** BLOCKER  
**Affected Screen:** App shell  
**Category:** Architecture  
**Area:** Mobile Native  

**Problem:**  
Capacitor app is a bare WebView wrap: no Camera, Geolocation, Push, Preferences, or Filesystem plugins; package.json has no cap sync/run scripts.

**Root Cause:**  
Only @capacitor/core + android installed.

**Expected Behaviour:**  
Native plugins for camera, location, push, secure storage; npm scripts for sync/build.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-004 (BLOCKER).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: Capacitor app is a bare WebView wrap: no Camera, Geolocation, Push, Preferences, or Filesystem plugins; package.json has no cap sync/run scripts.
- Root cause: Only @capacitor/core + android installed.
- Expected: Native plugins for camera, location, push, secure storage; npm scripts for sync/build.

PRIMARY FILES
- apps/gaadiiq-angular/package.json, apps/gaadiiq-angular/capacitor.config.ts, apps/gaadiiq-angular/android/app/capacitor.build.gradle
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-004.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-004 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-005 — CRITICAL — AndroidManifest

**Issue ID:** MOB-005  
**Severity:** CRITICAL  
**Affected Screen:** AndroidManifest  
**Category:** Security  
**Area:** Security  

**Problem:**  
android:allowBackup="true" allows ADB backup of WebView data including localStorage (wishlist, journey, possibly session fragments).

**Root Cause:**  
Default Capacitor manifest not hardened.

**Expected Behaviour:**  
allowBackup=false; exclude sensitive paths; disable cleartext.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-005 (CRITICAL).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: android:allowBackup="true" allows ADB backup of WebView data including localStorage (wishlist, journey, possibly session fragments).
- Root cause: Default Capacitor manifest not hardened.
- Expected: allowBackup=false; exclude sensitive paths; disable cleartext.

PRIMARY FILES
- apps/gaadiiq-angular/android/app/src/main/AndroidManifest.xml
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-005.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-005 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-006 — CRITICAL — Network

**Issue ID:** MOB-006  
**Severity:** CRITICAL  
**Affected Screen:** Network  
**Category:** Security  
**Area:** Security  

**Problem:**  
No SSL/certificate pinning and no Network Security Config; MITM on user devices possible for API/Supabase traffic.

**Root Cause:**  
No pinning library or network_security_config.xml beyond defaults.

**Expected Behaviour:**  
Pin api.gaadiiq.com + Supabase host; fail closed on mismatch in release builds.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-006 (CRITICAL).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: No SSL/certificate pinning and no Network Security Config; MITM on user devices possible for API/Supabase traffic.
- Root cause: No pinning library or network_security_config.xml beyond defaults.
- Expected: Pin api.gaadiiq.com + Supabase host; fail closed on mismatch in release builds.

PRIMARY FILES
- apps/gaadiiq-angular/android/app/src/main/res/xml/, apps/gaadiiq-angular/capacitor.config.ts
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-006.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-006 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-007 — CRITICAL — AI Diagnosis API

**Issue ID:** MOB-007  
**Severity:** CRITICAL  
**Affected Screen:** AI Diagnosis API  
**Category:** Security  
**Area:** Security  

**Problem:**  
GET /diagnosis/{id} is unauthenticated → IDOR: anyone with UUID can read another user's diagnosis (vehicle + symptoms).

**Root Cause:**  
get_diagnosis has no Depends(get_current_user) or ownership check.

**Expected Behaviour:**  
Require auth; allow owner or admin only.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-007 (CRITICAL).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: GET /diagnosis/{id} is unauthenticated → IDOR: anyone with UUID can read another user's diagnosis (vehicle + symptoms).
- Root cause: get_diagnosis has no Depends(get_current_user) or ownership check.
- Expected: Require auth; allow owner or admin only.

PRIMARY FILES
- apps/api/routers/diagnosis.py
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-007.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-007 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-008 — CRITICAL — AI modules

**Issue ID:** MOB-008  
**Severity:** CRITICAL  
**Affected Screen:** AI modules  
**Category:** AI/Security  
**Area:** Security  

**Problem:**  
User-controlled text interpolated into LLM prompts with no sanitisation/injection fence — prompt injection risk; HLD claims sanitisation but code lacks it.

**Root Cause:**  
f-string prompt assembly in diagnosis.py / valuation.py / sentiment.py.

**Expected Behaviour:**  
Input length limits, delimiter fencing, instruction hierarchy, output schema validation, refusal tests.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-008 (CRITICAL).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: User-controlled text interpolated into LLM prompts with no sanitisation/injection fence — prompt injection risk; HLD claims sanitisation but code lacks it.
- Root cause: f-string prompt assembly in diagnosis.py / valuation.py / sentiment.py.
- Expected: Input length limits, delimiter fencing, instruction hierarchy, output schema validation, refusal tests.

PRIMARY FILES
- apps/api/services/diagnosis.py, apps/api/services/valuation.py, apps/api/services/sentiment.py
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-008.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-008 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-009 — CRITICAL — Registration / Login

**Issue ID:** MOB-009  
**Severity:** CRITICAL  
**Affected Screen:** Registration / Login  
**Category:** Missing Feature  
**Area:** Auth  

**Problem:**  
OTP / phone SMS authentication does not exist. Register may collect phone but AuthService.register() never uses verifyOtp.

**Root Cause:**  
Email/password + OAuth only.

**Expected Behaviour:**  
Phone OTP via Supabase or MSG91/Twilio for India primary mobile UX.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-009 (CRITICAL).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: OTP / phone SMS authentication does not exist. Register may collect phone but AuthService.register() never uses verifyOtp.
- Root cause: Email/password + OAuth only.
- Expected: Phone OTP via Supabase or MSG91/Twilio for India primary mobile UX.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/pages/register/, apps/gaadiiq-angular/src/app/services/auth.service.ts
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-009.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-009 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-010 — CRITICAL — City / Diagnosis geolocation

**Issue ID:** MOB-010  
**Severity:** CRITICAL  
**Affected Screen:** City / Diagnosis geolocation  
**Category:** Security/Mobile  
**Area:** Permissions  

**Problem:**  
App uses navigator.geolocation but AndroidManifest declares only INTERNET — no ACCESS_FINE_LOCATION / COARSE.

**Root Cause:**  
Web API used without native permission declarations/plugins.

**Expected Behaviour:**  
Add permissions + @capacitor/geolocation with runtime prompts.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-010 (CRITICAL).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: App uses navigator.geolocation but AndroidManifest declares only INTERNET — no ACCESS_FINE_LOCATION / COARSE.
- Root cause: Web API used without native permission declarations/plugins.
- Expected: Add permissions + @capacitor/geolocation with runtime prompts.

PRIMARY FILES
- apps/gaadiiq-angular/android/app/src/main/AndroidManifest.xml, apps/gaadiiq-angular/src/app/components/city-selector/
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-010.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-010 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-011 — CRITICAL — API calls

**Issue ID:** MOB-011  
**Severity:** CRITICAL  
**Affected Screen:** API calls  
**Category:** API  
**Area:** Auth Bridge  

**Problem:**  
ApiService.submitLoanInquiry hits /loans/inquiry but API exposes /loans/inquiries — broken loan lead capture.

**Root Cause:**  
Path typo / contract drift.

**Expected Behaviour:**  
Align client path; add contract test.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-011 (CRITICAL).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: ApiService.submitLoanInquiry hits /loans/inquiry but API exposes /loans/inquiries — broken loan lead capture.
- Root cause: Path typo / contract drift.
- Expected: Align client path; add contract test.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/services/api.service.ts, apps/api/routers/loans.py
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-011.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-011 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-012 — CRITICAL — Dealer/Admin

**Issue ID:** MOB-012  
**Severity:** CRITICAL  
**Affected Screen:** Dealer/Admin  
**Category:** Security  
**Area:** RBAC  

**Problem:**  
sellerGuard is client-side only. FastAPI dealer endpoints use soft Dealer-row checks; any user can POST /dealers/register. Role enums diverge (seller vs dealer).

**Root Cause:**  
No unified server-side role enforcement aligned with Angular.

**Expected Behaviour:**  
Unified roles; require_role on sensitive routes; adminGuard.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-012 (CRITICAL).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: sellerGuard is client-side only. FastAPI dealer endpoints use soft Dealer-row checks; any user can POST /dealers/register. Role enums diverge (seller vs dealer).
- Root cause: No unified server-side role enforcement aligned with Angular.
- Expected: Unified roles; require_role on sensitive routes; adminGuard.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/guards/seller.guard.ts, apps/api/routers/dealers.py, apps/api/core/dependencies.py
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-012.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-012 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-013 — HIGH — Insurance

**Issue ID:** MOB-013  
**Severity:** HIGH  
**Affected Screen:** Insurance  
**Category:** Missing Feature  
**Area:** Features  

**Problem:**  
No insurance enquiry API or partner quote flow; only client-side premium estimates / marketing.

**Root Cause:**  
PRD/LLD endpoints never implemented.

**Expected Behaviour:**  
POST insurance lead + partner deep-links with disclosure.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-013 (HIGH).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: No insurance enquiry API or partner quote flow; only client-side premium estimates / marketing.
- Root cause: PRD/LLD endpoints never implemented.
- Expected: POST insurance lead + partner deep-links with disclosure.

PRIMARY FILES
- apps/api/routers/, apps/gaadiiq-angular/src/app/pages/car-detail/
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-013.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-013 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-014 — HIGH — AI Chat

**Issue ID:** MOB-014  
**Severity:** HIGH  
**Affected Screen:** AI Chat  
**Category:** Missing Feature / AI  
**Area:** Features  

**Problem:**  
Ask GAADIIQ / POST /recommend/ai-chat (SSE) from LLD is not implemented.

**Root Cause:**  
Recommend is quiz/rules only.

**Expected Behaviour:**  
Streaming chat endpoint + mobile UI with citations/fallback.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-014 (HIGH).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: Ask GAADIIQ / POST /recommend/ai-chat (SSE) from LLD is not implemented.
- Root cause: Recommend is quiz/rules only.
- Expected: Streaming chat endpoint + mobile UI with citations/fallback.

PRIMARY FILES
- apps/api/routers/, apps/gaadiiq-angular/src/app/pages/ai-advisor/
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-014.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-014 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-015 — HIGH — Push Notifications

**Issue ID:** MOB-015  
**Severity:** HIGH  
**Affected Screen:** Push Notifications  
**Category:** Missing Feature  
**Area:** Features  

**Problem:**  
No FCM/APNs Capacitor push plugin; in-app notifications API unused by primary Supabase auth path.

**Root Cause:**  
Push never integrated.

**Expected Behaviour:**  
FCM + user tokens; deep links to bookings/price drops.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-015 (HIGH).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: No FCM/APNs Capacitor push plugin; in-app notifications API unused by primary Supabase auth path.
- Root cause: Push never integrated.
- Expected: FCM + user tokens; deep links to bookings/price drops.

PRIMARY FILES
- apps/gaadiiq-angular/android/, apps/api/routers/notifications.py
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-015.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-015 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-016 — HIGH — /ai-advisor

**Issue ID:** MOB-016  
**Severity:** HIGH  
**Affected Screen:** /ai-advisor  
**Category:** AI  
**Area:** AI Advisor  

**Problem:**  
Angular advisor uses local heuristic scoring; not wired to POST /recommend. Diverges from Next.js advisor.

**Root Cause:**  
Client-only engine shipped as AI.

**Expected Behaviour:**  
Call API; method badge; unify scoring; use CityService.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-016 (HIGH).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: Angular advisor uses local heuristic scoring; not wired to POST /recommend. Diverges from Next.js advisor.
- Root cause: Client-only engine shipped as AI.
- Expected: Call API; method badge; unify scoring; use CityService.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/pages/ai-advisor/ai-advisor.component.ts, apps/api/routers/recommend.py
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-016.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-016 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-017 — HIGH — Wishlist / Price Alerts / Reviews

**Issue ID:** MOB-017  
**Severity:** HIGH  
**Affected Screen:** Wishlist / Price Alerts / Reviews  
**Category:** Reliability  
**Area:** Data  

**Problem:**  
Wishlist, price alerts, recently viewed persist only in localStorage — lost on reinstall, not cross-device.

**Root Cause:**  
Offline-first shortcuts without sync layer.

**Expected Behaviour:**  
Authenticated CRUD against API; local cache as offline mirror.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-017 (HIGH).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: Wishlist, price alerts, recently viewed persist only in localStorage — lost on reinstall, not cross-device.
- Root cause: Offline-first shortcuts without sync layer.
- Expected: Authenticated CRUD against API; local cache as offline mirror.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/pages/used-cars/, apps/gaadiiq-angular/src/app/pages/price-alerts/
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-017.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-017 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-018 — HIGH — List Car / Diagnosis

**Issue ID:** MOB-018  
**Severity:** HIGH  
**Affected Screen:** List Car / Diagnosis  
**Category:** Security  
**Area:** Uploads  

**Problem:**  
Audio/video/document upload unsupported. List-car uses Cloudinary unsigned preset (abuse risk). Upload MIME allowlist only; vision may fetch arbitrary image_urls (SSRF).

**Root Cause:**  
No magic bytes/AV; unsigned Cloudinary; unrestricted vision URLs.

**Expected Behaviour:**  
Magic bytes, size caps, AV scan, signed uploads, SSRF allowlist.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-018 (HIGH).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: Audio/video/document upload unsupported. List-car uses Cloudinary unsigned preset (abuse risk). Upload MIME allowlist only; vision may fetch arbitrary image_urls (SSRF).
- Root cause: No magic bytes/AV; unsigned Cloudinary; unrestricted vision URLs.
- Expected: Magic bytes, size caps, AV scan, signed uploads, SSRF allowlist.

PRIMARY FILES
- apps/api/routers/upload.py, apps/api/services/vision.py, apps/gaadiiq-angular/src/app/services/cloudinary.service.ts
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-018.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-018 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-019 — HIGH — API

**Issue ID:** MOB-019  
**Severity:** HIGH  
**Affected Screen:** API  
**Category:** Security/Performance  
**Area:** Rate Limit  

**Problem:**  
SlowAPI rate limits disabled unless environment==production; diagnosis/analyse not limited; /metrics public.

**Root Cause:**  
Limiter gated; incomplete decoration.

**Expected Behaviour:**  
Enable limits in staging; rate-limit diagnosis; protect /metrics.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-019 (HIGH).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: SlowAPI rate limits disabled unless environment==production; diagnosis/analyse not limited; /metrics public.
- Root cause: Limiter gated; incomplete decoration.
- Expected: Enable limits in staging; rate-limit diagnosis; protect /metrics.

PRIMARY FILES
- apps/api/core/limiter.py, apps/api/routers/diagnosis.py, apps/api/main.py
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-019.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-019 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-020 — HIGH — Intent / Diagnosis models

**Issue ID:** MOB-020  
**Severity:** HIGH  
**Affected Screen:** Intent / Diagnosis models  
**Category:** Database  
**Area:** Database  

**Problem:**  
customer_activities/intent_scores FK columns String(36) vs UUID PKs; vehicle_diagnoses.user_id nullable without FK.

**Root Cause:**  
Migration type mismatch in 0005/0006.

**Expected Behaviour:**  
UUID FKs with ON DELETE SET NULL/CASCADE; backfill.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-020 (HIGH).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: customer_activities/intent_scores FK columns String(36) vs UUID PKs; vehicle_diagnoses.user_id nullable without FK.
- Root cause: Migration type mismatch in 0005/0006.
- Expected: UUID FKs with ON DELETE SET NULL/CASCADE; backfill.

PRIMARY FILES
- apps/api/alembic/versions/0005_customer_intent_tables.py, apps/api/alembic/versions/0006_vehicle_diagnosis.py
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-020.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-020 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-021 — HIGH — API

**Issue ID:** MOB-021  
**Severity:** HIGH  
**Affected Screen:** API  
**Category:** API  
**Area:** CORS  

**Problem:**  
Default allowed_origins is localhost:3000; Capacitor/Android and Angular :4200 may be blocked against production API.

**Root Cause:**  
CORS not listing mobile/web production origins.

**Expected Behaviour:**  
Explicit allowlist: web, capacitor origins, staging.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-021 (HIGH).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: Default allowed_origins is localhost:3000; Capacitor/Android and Angular :4200 may be blocked against production API.
- Root cause: CORS not listing mobile/web production origins.
- Expected: Explicit allowlist: web, capacitor origins, staging.

PRIMARY FILES
- apps/api/main.py, apps/api/core/config.py
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-021.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-021 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-022 — HIGH — Mobile QA

**Issue ID:** MOB-022  
**Severity:** HIGH  
**Affected Screen:** Mobile QA  
**Category:** Quality  
**Area:** Testing  

**Problem:**  
Only 1 Angular unit spec (boilerplate broken); no Appium/Detox against Capacitor; Android instrumented tests still Capacitor sample package names.

**Root Cause:**  
No mobile test strategy executed.

**Expected Behaviour:**  
Contract tests + critical-path Appium; fix sample tests; CI on PR.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-022 (HIGH).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: Only 1 Angular unit spec (boilerplate broken); no Appium/Detox against Capacitor; Android instrumented tests still Capacitor sample package names.
- Root cause: No mobile test strategy executed.
- Expected: Contract tests + critical-path Appium; fix sample tests; CI on PR.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/app.component.spec.ts, apps/gaadiiq-angular/android/app/src/androidTest/
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-022.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-022 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-023 — MEDIUM — Used Cars Budget Slider

**Issue ID:** MOB-023  
**Severity:** MEDIUM  
**Affected Screen:** Used Cars Budget Slider  
**Category:** UI/UX  
**Area:** UX  

**Problem:**  
Dual-range slider: WebKit thumb misalignment (no margin-top), no z-index swap when thumbs overlap, track not clickable.

**Root Cause:**  
CSS dual-range incomplete.

**Expected Behaviour:**  
Centered thumbs, dynamic z-index, accessible labels.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-023 (MEDIUM).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: Dual-range slider: WebKit thumb misalignment (no margin-top), no z-index swap when thumbs overlap, track not clickable.
- Root cause: CSS dual-range incomplete.
- Expected: Centered thumbs, dynamic z-index, accessible labels.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/pages/used-cars/used-cars.component.scss
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-023.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-023 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-024 — MEDIUM — Used Cars

**Issue ID:** MOB-024  
**Severity:** MEDIUM  
**Affected Screen:** Used Cars  
**Category:** UI/UX  
**Area:** UX  

**Problem:**  
showAllIndiaBanner requires !allIndiaOverride so amber banner never shows after auto-override for empty cities.

**Root Cause:**  
Inverted banner condition.

**Expected Behaviour:**  
Show banner when override active.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-024 (MEDIUM).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: showAllIndiaBanner requires !allIndiaOverride so amber banner never shows after auto-override for empty cities.
- Root cause: Inverted banner condition.
- Expected: Show banner when override active.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/pages/used-cars/used-cars.component.ts
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-024.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-024 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-025 — MEDIUM — New Cars

**Issue ID:** MOB-025  
**Severity:** MEDIUM  
**Affected Screen:** New Cars  
**Category:** Functional  
**Area:** Features  

**Problem:**  
New Cars P0 fixes (Above ₹30L applyBudget) live on cursor/fix-new-cars-module-85e1 and are NOT merged into Claude tip.

**Root Cause:**  
Unmerged fix branch.

**Expected Behaviour:**  
Merge/cherry-pick fix branch.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-025 (MEDIUM).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: New Cars P0 fixes (Above ₹30L applyBudget) live on cursor/fix-new-cars-module-85e1 and are NOT merged into Claude tip.
- Root cause: Unmerged fix branch.
- Expected: Merge/cherry-pick fix branch.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/pages/new-cars/
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-025.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-025 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-026 — MEDIUM — EV / TCO

**Issue ID:** MOB-026  
**Severity:** MEDIUM  
**Affected Screen:** EV / TCO  
**Category:** Missing Feature  
**Area:** Features  

**Problem:**  
No dedicated EV calculator screen; TCO service exists but weak mobile discovery.

**Root Cause:**  
Feature incomplete in IA.

**Expected Behaviour:**  
EV cost/range calculator page; TCO entry from car detail.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-026 (MEDIUM).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: No dedicated EV calculator screen; TCO service exists but weak mobile discovery.
- Root cause: Feature incomplete in IA.
- Expected: EV cost/range calculator page; TCO entry from car detail.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/services/tco.service.ts
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-026.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-026 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-027 — MEDIUM — Dealer Search / Service History

**Issue ID:** MOB-027  
**Severity:** MEDIUM  
**Affected Screen:** Dealer Search / Service History  
**Category:** Missing Feature  
**Area:** Features  

**Problem:**  
No dealer directory search; service booking only opens maps to static SERVICE_CENTERS; no service history.

**Root Cause:**  
Diagnosis CTA stub.

**Expected Behaviour:**  
Dealer search API+UI; booking persistence; history.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-027 (MEDIUM).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: No dealer directory search; service booking only opens maps to static SERVICE_CENTERS; no service history.
- Root cause: Diagnosis CTA stub.
- Expected: Dealer search API+UI; booking persistence; history.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/pages/vehicle-diagnosis/
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-027.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-027 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-028 — MEDIUM — Global

**Issue ID:** MOB-028  
**Severity:** MEDIUM  
**Affected Screen:** Global  
**Category:** Accessibility  
**Area:** A11y  

**Problem:**  
Sparse ARIA; many outline:none without :focus-visible; no TalkBack/VoiceOver pass; contrast not systematically verified.

**Root Cause:**  
A11y not a release gate.

**Expected Behaviour:**  
WCAG 2.2 AA on top flows.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-028 (MEDIUM).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: Sparse ARIA; many outline:none without :focus-visible; no TalkBack/VoiceOver pass; contrast not systematically verified.
- Root cause: A11y not a release gate.
- Expected: WCAG 2.2 AA on top flows.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/**/*.html, apps/gaadiiq-angular/src/styles.scss
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-028.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-028 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-029 — MEDIUM — Listings / Images

**Issue ID:** MOB-029  
**Severity:** MEDIUM  
**Affected Screen:** Listings / Images  
**Category:** Performance  
**Area:** Performance  

**Problem:**  
Listing grids without virtual scroll; no measured startup/FPS/memory on device.

**Root Cause:**  
No perf budget in CI.

**Expected Behaviour:**  
Virtual scroll, image sizing, WebView metrics.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-029 (MEDIUM).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: Listing grids without virtual scroll; no measured startup/FPS/memory on device.
- Root cause: No perf budget in CI.
- Expected: Virtual scroll, image sizing, WebView metrics.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/pages/listings/, apps/gaadiiq-angular/ngsw-config.json
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-029.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-029 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-030 — MEDIUM — Global

**Issue ID:** MOB-030  
**Severity:** MEDIUM  
**Affected Screen:** Global  
**Category:** Reliability  
**Area:** Offline  

**Problem:**  
No true offline mode; SW precaches shell only; forms fail opaquely offline; no queue/retry.

**Root Cause:**  
PWA shell ≠ offline product.

**Expected Behaviour:**  
Offline banner, queued mutations, read-through cache.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-030 (MEDIUM).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: No true offline mode; SW precaches shell only; forms fail opaquely offline; no queue/retry.
- Root cause: PWA shell ≠ offline product.
- Expected: Offline banner, queued mutations, read-through cache.

PRIMARY FILES
- apps/gaadiiq-angular/ngsw-config.json
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-030.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-030 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-031 — MEDIUM — EMI Calculator

**Issue ID:** MOB-031  
**Severity:** MEDIUM  
**Affected Screen:** EMI Calculator  
**Category:** Business Rules  
**Area:** EMI  

**Problem:**  
Bank rates are hardcoded stubs; client EMI not using GET /loans/emi-calculator.

**Root Cause:**  
Marketing calculator.

**Expected Behaviour:**  
Disclose indicative; sync API calculator.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-031 (MEDIUM).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: Bank rates are hardcoded stubs; client EMI not using GET /loans/emi-calculator.
- Root cause: Marketing calculator.
- Expected: Disclose indicative; sync API calculator.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/pages/emi-calculator/
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-031.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-031 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-032 — MEDIUM — Dealer Dashboard

**Issue ID:** MOB-032  
**Severity:** MEDIUM  
**Affected Screen:** Dealer Dashboard  
**Category:** Security/Privacy  
**Area:** Sentiment  

**Problem:**  
Public sentiment track endpoint forgeable; no customer consent UX.

**Root Cause:**  
Privacy/product gap.

**Expected Behaviour:**  
Consent, auth-only tracking, disclosure.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-032 (MEDIUM).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: Public sentiment track endpoint forgeable; no customer consent UX.
- Root cause: Privacy/product gap.
- Expected: Consent, auth-only tracking, disclosure.

PRIMARY FILES
- apps/api/routers/sentiment.py
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-032.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-032 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-033 — MEDIUM — Devices

**Issue ID:** MOB-033  
**Severity:** MEDIUM  
**Affected Screen:** Devices  
**Category:** Compatibility  
**Area:** Compatibility  

**Problem:**  
minSdk 24 but product asks Android 12+ validation; foldable/tablet/landscape untested; no iPad.

**Root Cause:**  
No device matrix execution.

**Expected Behaviour:**  
Document and execute supported device matrix.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-033 (MEDIUM).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: minSdk 24 but product asks Android 12+ validation; foldable/tablet/landscape untested; no iPad.
- Root cause: No device matrix execution.
- Expected: Document and execute supported device matrix.

PRIMARY FILES
- apps/gaadiiq-angular/android/variables.gradle
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-033.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-033 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-034 — LOW — Android tests

**Issue ID:** MOB-034  
**Severity:** LOW  
**Affected Screen:** Android tests  
**Category:** Quality  
**Area:** Code Quality  

**Problem:**  
Instrumented tests still reference com.getcapacitor.myapp / ExampleUnitTest.

**Root Cause:**  
Capacitor template leftover.

**Expected Behaviour:**  
Replace with GAADIIQ smoke or remove from CI.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-034 (LOW).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: Instrumented tests still reference com.getcapacitor.myapp / ExampleUnitTest.
- Root cause: Capacitor template leftover.
- Expected: Replace with GAADIIQ smoke or remove from CI.

PRIMARY FILES
- apps/gaadiiq-angular/android/app/src/test/, androidTest/
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-034.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-034 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-035 — LOW — Used Cars empty state

**Issue ID:** MOB-035  
**Severity:** LOW  
**Affected Screen:** Used Cars empty state  
**Category:** UI/UX  
**Area:** UX  

**Problem:**  
No AI Advisor CTA when filters yield 0 results; no URL write-back for filters.

**Root Cause:**  
Incomplete empty-state IA.

**Expected Behaviour:**  
Advisor link + query sync.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-035 (LOW).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: No AI Advisor CTA when filters yield 0 results; no URL write-back for filters.
- Root cause: Incomplete empty-state IA.
- Expected: Advisor link + query sync.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/pages/used-cars/
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-035.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-035 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-036 — LOW — History

**Issue ID:** MOB-036  
**Severity:** LOW  
**Affected Screen:** History  
**Category:** Functional  
**Area:** AI Diagnosis  

**Problem:**  
API /diagnosis/history exists but Angular wizard has no history UI.

**Root Cause:**  
UI incomplete.

**Expected Behaviour:**  
Past diagnoses list with reopen.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-036 (LOW).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: API /diagnosis/history exists but Angular wizard has no history UI.
- Root cause: UI incomplete.
- Expected: Past diagnoses list with reopen.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/pages/vehicle-diagnosis/
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-036.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-036 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-037 — LOW — Root/Jailbreak

**Issue ID:** MOB-037  
**Severity:** LOW  
**Affected Screen:** Root/Jailbreak  
**Category:** Security  
**Area:** Security  

**Problem:**  
No root/jailbreak detection or Play Integrity on release builds.

**Root Cause:**  
Not implemented.

**Expected Behaviour:**  
Play Integrity / DeviceCheck gated for payments.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-037 (LOW).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: No root/jailbreak detection or Play Integrity on release builds.
- Root cause: Not implemented.
- Expected: Play Integrity / DeviceCheck gated for payments.

PRIMARY FILES
- apps/gaadiiq-angular/android/
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-037.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-037 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-038 — LOW — Environments

**Issue ID:** MOB-038  
**Severity:** LOW  
**Affected Screen:** Environments  
**Category:** Maintainability  
**Area:** Config  

**Problem:**  
.env.example documents HS256 SECRET_KEY while API uses RS256 PEMs.

**Root Cause:**  
Stale docs.

**Expected Behaviour:**  
Align examples with JWT key files.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-038 (LOW).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: .env.example documents HS256 SECRET_KEY while API uses RS256 PEMs.
- Root cause: Stale docs.
- Expected: Align examples with JWT key files.

PRIMARY FILES
- apps/api/.env.example, apps/api/core/config.py
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-038.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-038 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-039 — LOW — API

**Issue ID:** MOB-039  
**Severity:** LOW  
**Affected Screen:** API  
**Category:** Security  
**Area:** Payments Webhook  

**Problem:**  
When Razorpay keys unset, webhook verification may be open — dangerous if mis-deployed.

**Root Cause:**  
Dev shortcuts.

**Expected Behaviour:**  
Fail closed without keys outside local dev.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-039 (LOW).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: When Razorpay keys unset, webhook verification may be open — dangerous if mis-deployed.
- Root cause: Dev shortcuts.
- Expected: Fail closed without keys outside local dev.

PRIMARY FILES
- apps/api/routers/payments.py
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-039.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-039 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```


---

## MOB-040 — LOW — Settings

**Issue ID:** MOB-040  
**Severity:** LOW  
**Affected Screen:** Settings  
**Category:** Missing Feature  
**Area:** Profile  

**Problem:**  
No dedicated Settings/Profile edit screen; no DPDP delete-account flow.

**Root Cause:**  
Thin account IA.

**Expected Behaviour:**  
Profile, notification prefs, privacy, delete account.

**Suggested Fix:**  
Implement expected behaviour; preserve backward-compatible UX where safe; add regression tests.

### COMPLETE Claude Code Implementation Prompt

```
You are implementing GAADIIQ fix MOB-040 (LOW).

CONTEXT
- Monorepo: apps/gaadiiq-angular (Capacitor Android + Angular), apps/api (FastAPI), apps/web (Next.js).
- Problem: No dedicated Settings/Profile edit screen; no DPDP delete-account flow.
- Root cause: Thin account IA.
- Expected: Profile, notification prefs, privacy, delete account.

PRIMARY FILES
- apps/gaadiiq-angular/src/app/pages/
- Add/adjust tests under apps/api/tests/ and/or Angular specs.
- Update docs/qa only if behaviour contracts change.

REQUIREMENTS
1. Frontend: UX/logic fix; loading/error/empty states; no silent failures.
2. Backend: authz, validation, correct HTTP codes, structured errors.
3. Database: Alembic migration if schema changes; reversible where possible.
4. API: OpenAPI-consistent; version if breaking.
5. Security: least privilege; no secrets in client; validate uploads/inputs; close IDOR/injection if in scope.
6. Validation: reject blank/oversized abuse; +91 phone rules if touching auth.
7. Errors: user-safe messages; server logs with request id.
8. Unit tests: happy path + ≥2 negative cases.
9. Integration/regression: cover the broken path for MOB-040.
10. Mobile: if Manifest/plugins change, note capacitor sync in commit message.

ACCEPTANCE
- MOB-040 fail → pass with automated test or explicit manual checklist in PR.
- No new lint/type errors.
- Do not regress Used Cars P0 city/year fixes or diagnosis client fallback.

Deliver a concise PR description with files touched and test commands run.
```
