# Claude Fix Prompt Pack — How to Use

**Full per-issue prompts (MOB-001 … MOB-040):**  
[`docs/qa/mobile/Claude_Fix_Prompts.md`](./Claude_Fix_Prompts.md)

**Report:** [`GAADIIQ_Mobile_Production_QA_Report.md`](./GAADIIQ_Mobile_Production_QA_Report.md)

Feed Claude **one wave at a time**. Do not paste all 40 into one session.

---

## Recommended order

| Wave | Issues | Goal |
|------|--------|------|
| **0 — Master context** | — | Paste once at start of each Claude session |
| **1 — P0 Security & Auth** | MOB-002, 005, 006, 007, 008, 010, 011, 012, 039 | Unblock API + stop data leaks |
| **2 — P0 Product blockers** | MOB-003, 004, 009 | Payments, native shell, OTP |
| **3 — P0 Platform** | MOB-001 | iOS (or explicitly defer with Android-only beta label) |
| **4 — P1 Features** | MOB-013–022 | Insurance, chat, push, advisor, uploads, DB, CORS, tests |
| **5 — P2 Polish** | MOB-023–033 | Slider, New Cars merge, a11y, offline, EMI |
| **6 — P3 Cleanup** | MOB-034–040 | Tests template, empty CTA, history UI, settings |

---

## Wave 0 — Master context (paste first every session)

```
You are fixing GAADIIQ production blockers from docs/qa/mobile/.

REPO TRUTH
- Mobile = Capacitor 8 Android WebView around Angular SPA at apps/gaadiiq-angular (appId com.gaadiiq.app).
- There is NO ios/ project yet.
- Angular auth = Supabase (auth.service.ts). FastAPI auth = RS256 JWT. These are NOT bridged.
- FastAPI lives in apps/api. Next.js in apps/web (do not break web unless asked).
- Do NOT regress: Used Cars P0 (city alias New Town→Kolkata, year selects, clearCity, All India override), diagnosis client KB fallback, valuation method badges.

RULES
1. Implement only the issue IDs I list in this message.
2. For each ID: code + tests + short PR notes.
3. Prefer smallest correct fix; no drive-by refactors.
4. After changes, list files touched and how to verify.
5. If a fix depends on another MOB-* not in scope, stub safely and note the dependency.

Source of truth for each issue: docs/qa/mobile/Claude_Fix_Prompts.md and Issues_Catalog.json.
```

---

## Wave 1 — P0 Security & Auth (paste next)

```
Implement these GAADIIQ issues NOW (in order). Full specs in docs/qa/mobile/Claude_Fix_Prompts.md:

MOB-007 — CRITICAL — Secure GET /diagnosis/{id}: require auth + ownership (or admin). Add pytest for IDOR denied.
MOB-008 — CRITICAL — Add LLM prompt sanitisation/fencing for diagnosis, valuation, sentiment (apps/api/services/*). Length limits, delimiter blocks, schema validation, unit tests for injection strings.
MOB-005 — CRITICAL — AndroidManifest allowBackup=false; harden backup rules.
MOB-006 — CRITICAL — Add network security config + certificate pinning strategy for api.gaadiiq.com and Supabase host (release builds fail closed).
MOB-010 — CRITICAL — Declare ACCESS_FINE/COARSE_LOCATION; integrate @capacitor/geolocation (or document WebView limitation and gate UI). Runtime permission prompts.
MOB-011 — CRITICAL — Fix ApiService loan path: /loans/inquiry → /loans/inquiries. Add contract test.
MOB-012 — CRITICAL — Align seller/dealer/admin RBAC: server-side require_role; adminGuard; stop open dealer self-upgrade abuse or gate it.
MOB-039 — LOW but security — Payments webhook must fail closed when Razorpay keys missing outside local/dev.
MOB-002 — BLOCKER — Design+implement auth bridge so Angular Supabase session can call FastAPI (validate Supabase JWT in API OR exchange for FastAPI tokens). Wire ApiService Authorization header. Prove /auth/me or /diagnosis/history works from Angular with logged-in user.

Do not start MOB-001/003/004 in this wave.
Commit per logical group if needed. Run relevant pytest.
```

---

## Wave 2 — Payments, native shell, OTP

```
Using Wave 0 context + docs/qa/mobile/Claude_Fix_Prompts.md, implement:

MOB-003 — BLOCKER — Wire Razorpay checkout in Angular pricing-plans / feature listing against apps/api /payments/* (create → checkout → verify). If keys absent, show honest “payments unavailable” — remove false UPI/Razorpay claims from copy.
MOB-004 — BLOCKER — Add Capacitor plugins: camera, geolocation, preferences (secure storage), push-notifications (stub OK if FCM keys missing). Add npm scripts: cap:sync, cap:android. Update capacitor.build.gradle dependencies.
MOB-009 — CRITICAL — Phone OTP auth for India (+91): Supabase verifyOtp or MSG91/Twilio. Wire register/login UI; stop collecting unused phone.

Acceptance: Android build syncs; payment happy-path works in test mode OR is clearly disabled; OTP send+verify works in staging.
```

---

## Wave 3 — iOS (or defer)

```
Option A (ship iOS):
Implement MOB-001 from docs/qa/mobile/Claude_Fix_Prompts.md — add Capacitor iOS project, Info.plist permissions (camera, location, photo library), npm cap:ios script, README build steps.

Option B (defer iOS for Android-only beta):
Do NOT scaffold iOS. Instead:
1. Document Android-only Tech Preview in README + Play listing notes.
2. Add in-app banner: “Android preview — iOS coming soon”.
3. Mark MOB-001 as deferred in docs/qa/mobile/Issues_Catalog.json status field.
Choose Option B only if product confirms Android-only beta.
```

---

## Wave 4 — P1 Features (batch)

```
Implement HIGH issues from docs/qa/mobile/Claude_Fix_Prompts.md in this order:

MOB-021 — CORS allowlist for Angular :4200, production web, Capacitor origins.
MOB-019 — Enable rate limits in staging; rate-limit POST /diagnosis/analyse; protect GET /metrics.
MOB-020 — Fix Alembic UUID FK mismatches (intent tables + diagnosis.user_id FK).
MOB-018 — Upload hardening: magic bytes, size caps; SSRF allowlist in vision.py; prefer signed Cloudinary or API /upload only.
MOB-016 — Wire Angular /ai-advisor to POST /recommend (keep client fallback); show method badge; use city.
MOB-017 — Persist wishlist + price alerts via API when logged in (localStorage as cache only).
MOB-015 — FCM push via Capacitor (or clear “coming soon” if keys missing).
MOB-014 — Implement POST /recommend/ai-chat SSE + minimal Angular chat UI with fallback.
MOB-013 — Insurance enquiry API + car-detail CTA (lead only is OK).
MOB-022 — Fix broken Angular app.component.spec; add API contract tests for diagnosis auth; replace Capacitor sample androidTest package names.

Skip anything already done in earlier waves.
```

---

## Wave 5 — P2 Polish

```
Implement MEDIUM issues from docs/qa/mobile/Claude_Fix_Prompts.md:

MOB-025 — Cherry-pick/merge New Cars fixes from cursor/fix-new-cars-module-85e1 (Above ₹30L applyBudget, Electric/Luxury).
MOB-023 — Fix Used Cars dual-range slider WebKit thumb centering + z-index when thumbs overlap + aria labels.
MOB-024 — Fix showAllIndiaBanner to show when allIndiaOverride is true.
MOB-031 — EMI calculator: call GET /loans/emi-calculator OR label rates “indicative/demo”.
MOB-028 — Accessibility pass on navbar, login, used-cars, diagnosis: aria, focus-visible, contrast.
MOB-032 — Remove or auth-protect public sentiment track; add consent copy.
MOB-026 — EV calculator page or clear entry from car detail + TCO link.
MOB-027 — Dealer search stub API+UI OR honest empty state; service history backlog note.
MOB-029 — Virtual scroll or pagination hardening on listings.
MOB-030 — Offline banner + fail soft on mutations when navigator.onLine is false.
MOB-033 — Document supported device matrix (Android 12+ primary); set minSdk policy in README.
```

---

## Wave 6 — P3 Cleanup

```
Implement LOW issues from docs/qa/mobile/Claude_Fix_Prompts.md:

MOB-034 — Replace or delete Capacitor ExampleUnitTest / wrong package instrumented tests.
MOB-035 — Used Cars empty state: link to /ai-advisor; write filters to query params.
MOB-036 — Diagnosis history UI for logged-in users (GET /diagnosis/history).
MOB-037 — Play Integrity hook stub for release (gate payments later).
MOB-038 — Fix apps/api/.env.example for RS256 JWT keys (remove stale HS256 SECRET_KEY docs).
MOB-040 — Settings/Profile page: theme, city, logout, delete-account request (DPDP).
```

---

## Single-issue template (if you prefer one ID at a time)

```
Read docs/qa/mobile/Claude_Fix_Prompts.md section for {ISSUE_ID}.
Implement ONLY {ISSUE_ID}.
Follow its COMPLETE Claude Code Implementation Prompt block exactly.
After done: summarize files, tests run, and any follow-ups.
```

Replace `{ISSUE_ID}` with e.g. `MOB-007`.

---

## Do-not-mix warnings

- **MOB-002 before** relying on payments/history/notifications from Angular.
- **MOB-007 + MOB-008 before** marketing AI Diagnosis as production-safe.
- **MOB-003** either ships real checkout or removes Razorpay claims — no middle ground.
- **MOB-001** is large; keep it in its own Claude session.
