# Claude Fix Prompts — Auth Bottom Nav + Find Cars Alignment

Source: `docs/qa/mobile/Revalidate_After_Fixes.md`  
Branch context: `claude/gaadiiq-app-dev-abj5fo` (LAY fixes already merged)

Paste **Wave 0** then **Prompt A** then **Prompt B**.

---

## Wave 0 — Master context

```
You are fixing GAADIIQ Angular Capacitor mobile UX bugs on apps/gaadiiq-angular.

CONFIRMED BUGS (do not argue — code evidence exists):
1) AUTH-01: home.component.html mobile-bottom-nav "Account" always routerLink="/login" — after Sign In there is no way to open profile/Sign Out from bottom nav.
2) FC-*: "Find The Cars Of Your Choice" tabs use white-space:nowrap with no overflow-x / no mobile @media — misaligned on phone.

DO NOT regress: LAY-001..012 (safe-area, compare scroll, brands 2-col, used-cars sheet, slider thumbs), diagnosis auth, auth interceptor.

After each fix: list files + how to verify on 390×844.
```

---

## Prompt A — AUTH-01 / AUTH-02 / AUTH-03 (Sign In stuck)

```
Implement AUTH-01, AUTH-02, AUTH-03 from docs/qa/mobile/Revalidate_After_Fixes.md.

### AUTH-01 (P0) — Mobile bottom nav Account must be auth-aware
Files:
- apps/gaadiiq-angular/src/app/pages/home/home.component.html
- apps/gaadiiq-angular/src/app/pages/home/home.component.ts (import AuthService if needed)
- apps/gaadiiq-angular/src/app/pages/home/home.component.scss
- Optionally extract bottom nav to a shared component if also used elsewhere (search mobile-bottom-nav)

Required behaviour:
- If !auth.isLoggedIn(): Account → /login (label "Sign In" or "Account")
- If auth.isLoggedIn(): Account → /profile (preferred) OR open a bottom sheet with: user name/email, My Profile, My Listings, Sell My Car, Sign Out
- Sign Out must call auth.logout() and update UI immediately
- routerLinkActive should highlight correctly for /profile not /login when logged in
- Do NOT leave a permanent Sign In entry point that ignores session

Also check navbar (desktop + hamburger) still correct — already mostly wired; ensure hydrate race fixed below so Sign In disappears after login.

### AUTH-03 (P1) — Eliminate login hydrate race
File: apps/gaadiiq-angular/src/app/services/auth.service.ts

In login():
- After signInWithPassword succeeds, await hydrateUser(email) BEFORE returning
- Ensure currentUser signal is non-null before LoginComponent navigates away
- Same for register path when session is returned immediately

### AUTH-02 (P1) — Safe area on bottom nav
File: home.component.scss .mobile-bottom-nav
- padding-bottom: max(0.75rem, var(--safe-bottom));
- Ensure home page has enough padding-bottom so last content clears the nav (e.g. padding-bottom on body of home or last section ≈ 72px + safe-bottom)

### Tests
- Unit: AuthService.login sets currentUser before resolve (mock Supabase)
- Component smoke: bottom nav template branches on isLoggedIn
- Manual checklist: TC-AUTH-01..04 in Revalidate_After_Fixes.md

Acceptance:
- After Sign In on phone, bottom Account is NOT a dead Sign In loop
- User can Sign Out from Account without opening hamburger
```

---

## Prompt B — Find The Cars Of Your Choice mobile alignment (FC-01…04)

```
Implement FC-01, FC-02, FC-03, FC-04 from docs/qa/mobile/Revalidate_After_Fixes.md.

Files:
- apps/gaadiiq-angular/src/app/pages/home/home.component.html (minimal markup changes if needed)
- apps/gaadiiq-angular/src/app/pages/home/home.component.scss

### FC-01 (P0) — Tabs must fit phones
.current problem:
- .find-tab { white-space: nowrap }
- 5 tabs: Budget | Body Type | Fuel Type | Transmission | Seating Capacity
- .find-cars-tabs has no overflow-x

Fix:
- .find-cars-tabs {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none; // optional hide scrollbar
    gap: 0.25rem;
  }
- Keep nowrap on individual tabs OR allow wrap under 380px — prefer horizontal scroll with scroll-snap for CarWale-like UX
- Ensure active tab underline still works while scrolling

### FC-02 / FC-03 (P0/P1) — Mobile spacing
Add:
@media (max-width: 768px) {
  .find-cars-card { padding: 1.25rem 1rem 1.25rem; }
  .find-cars-title { font-size: 1.1rem; margin-bottom: 1rem; }
  .find-tab { padding: 0.55rem 0.85rem; font-size: 0.82rem; }
  .find-pill { padding: 0.5rem 0.9rem; font-size: 0.8rem; min-height: 44px; display:inline-flex; align-items:center; }
}
@media (max-width: 480px) {
  .find-cars-card { padding: 1rem 0.85rem; border-radius: 12px; }
  .find-cars-title { font-size: 1.05rem; }
}

### FC-04 — Clear bottom nav
- .find-cars-section { padding-bottom: ... } ensure overall home has padding-bottom: calc(72px + var(--safe-bottom)) on mobile so section isn’t hidden under bottom nav

### Tests
- Extend apps/gaadiiq-angular/e2e/mobile-layout.spec.ts:
  - On `/` at 360 and 390, assert no horizontal overflow
  - Optionally assert `.find-cars-tabs` scrollWidth >= clientWidth is OK only inside the tabs container (page scrollWidth still OK)

Acceptance:
- On 360×800 screenshot, Find Cars looks intentional (scrollable tabs or neat wrap), pills wrap, no clipped title, no page-level horizontal scroll
```

---

## Prompt C — Combined (if one Claude session only)

```
Using Wave 0 context, implement BOTH Prompt A (AUTH-01/02/03) and Prompt B (FC-01..04) in one PR.

Order: AUTH first, then Find Cars.
Commit message suggestion:
fix(mobile): auth-aware bottom nav Account + Find Cars phone layout

Add/adjust unit + playwright checks listed in the prompts.
Do not touch unrelated MOB feature work.
```

---

## Single-issue templates

```
Implement ONLY AUTH-01 from docs/qa/mobile/Claude_Fix_AUTH_FindCars.md Prompt A.
```

```
Implement ONLY FC-01..03 from docs/qa/mobile/Claude_Fix_AUTH_FindCars.md Prompt B.
```
