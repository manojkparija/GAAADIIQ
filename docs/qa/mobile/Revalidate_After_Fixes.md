# Mobile Revalidation After Claude Fixes + New User Bugs

**Code tip:** `claude/gaadiiq-app-dev-abj5fo` @ `ad3102b`  
**Date:** 2026-07-21  
**Method:** Static code revalidation of LAY/MOB fixes + targeted audit of user-reported Sign In + Find Cars alignment  

---

## 1. Executive summary

Many **LAY-*** and **MOB-*** fixes are present on Claude tip (safe-area, compare scroll, brands grid, filter sheet, diagnosis auth, loans path, auth interceptor, allowBackup).

**Two user-visible bugs are still open and confirmed in code:**

| ID | Severity | Issue |
|----|----------|--------|
| **AUTH-01** | **P0** | After Sign In, mobile **bottom nav “Account” still goes to `/login`** — no profile / Sign Out on that control (“no option to deselect”) |
| **FC-01…03** | **P0/P1** | **“Find The Cars Of Your Choice”** tabs/pills still not phone-adapted (`nowrap` tabs, no section `@media`, heavy padding) |

**Static revalidate score this pass:** 16 PASS / 7 FAIL (23 checks) — see `revalidate-after-fixes.json`.

---

## 2. What was re-tested (fixed issues)

| ID | Check | Result |
|----|--------|--------|
| LAY-001 | `viewport-fit=cover` + `--safe-top` tokens + navbar | **PASS** |
| LAY-002 | Compare horizontal scroll | **PASS** |
| LAY-003 | Compare sticky/min-width mobile | **PASS** |
| LAY-004 | Brands 3-col @768 / 2-col @480 | **PASS** |
| LAY-006 | Used-cars filter bottom sheet | **PASS** |
| LAY-007 | `--nav-offset` | **PASS** |
| LAY-009 | Dual-range thumb `margin-top` | **PASS** |
| LAY-010 | Valuation how-grid phone breakpoints | **PASS** |
| LAY-012 | `e2e/mobile-layout.spec.ts` exists | **PASS** |
| MOB-005 | `allowBackup="false"` | **PASS** |
| MOB-007 | `GET /diagnosis/{id}` requires `get_current_user` | **PASS** |
| MOB-011 | Client uses `/loans/inquiries` | **PASS** |
| MOB-002 | `auth.interceptor` wired in `app.config` | **PASS** |
| AUTH-04 | Login page redirects if already logged in | **PASS** |

### Still FAIL / residual

| ID | Result | Note |
|----|--------|------|
| LAY-005 | FAIL | `overflow-x: hidden` still appears somewhere in `styles.scss` (partial) |
| AUTH-01 | **FAIL** | Bottom nav Account hard-coded to `/login` |
| AUTH-02 | FAIL | Bottom nav missing `--safe-bottom` |
| AUTH-03 | FAIL | `login()` does not await `hydrateUser` before navigate (race) |
| FC-01 | **FAIL** | `.find-tab { white-space: nowrap }` + tabs row has no `overflow-x: auto` |
| FC-02 | **FAIL** | No `@media` rules in find-cars SCSS block |
| FC-03 | **FAIL** | Card padding `2rem` fixed; not tightened for ≤480px |
| FC-04 | FAIL | Find-cars / page may sit under fixed bottom nav |

---

## 3. Root cause — Sign In still showing (AUTH-01)

**Evidence** (`home.component.html` mobile bottom nav):

```html
<a routerLink="/login" routerLinkActive="active">
  <app-icon name="user" [size]="20"></app-icon>
  <span>Account</span>
</a>
```

- Always routes to `/login` whether or not `auth.isLoggedIn()`.
- On phone, top navbar Sign In is hidden (`hide-mobile`); users live on **bottom nav**.
- After successful login they return to Home and still tap **Account → Sign In form**.
- There is **no Sign Out** on the bottom nav (hamburger has Sign Out, but bottom nav does not).

Desktop navbar *does* switch Sign In → avatar + Sign Out when `currentUser` is set — but hydrate race (AUTH-03) can leave Sign In visible briefly.

---

## 4. Root cause — Find Cars misaligned (FC-*)

**Evidence** (`home.component.scss`):

- `.find-tab { white-space: nowrap }` with 5 tabs: Budget, Body Type, Fuel Type, Transmission, Seating Capacity  
- `.find-cars-tabs` is `display:flex` with **no** `overflow-x: auto` and **no** wrap  
- `.find-cars-card { padding: 2rem }` with **no** mobile `@media` in that section  
- Pills wrap (`flex-wrap`) but tabs overflow horizontally on ~360px  

LAY-004 fixed brands grid; **find-cars section was never included** in LAY-001…012.

---

## 5. Test cases (manual / Playwright)

### A. Auth / Account (mobile 390×844)

| TC | Steps | Expected | Priority |
|----|--------|----------|----------|
| TC-AUTH-01 | Cold start → open Account on bottom nav | Sign In / Register | P0 |
| TC-AUTH-02 | Sign in with valid credentials → land on Home | Session active; bottom Account shows avatar/name or “Profile”, **not** “Sign In” | **P0** |
| TC-AUTH-03 | Tap Account while logged in | Opens Profile (or sheet) with **Sign Out** | **P0** |
| TC-AUTH-04 | Sign Out from Account | Returns to logged-out state; Account shows Sign In again | P0 |
| TC-AUTH-05 | While logged in, deep-link `/login` | Redirect away from login form | P1 |
| TC-AUTH-06 | Open hamburger while logged in | Shows name + Sign Out (already coded) | P1 |
| TC-AUTH-07 | Desktop: after login | Navbar shows avatar; Sign In button gone; Sign Out in dropdown | P0 |
| TC-AUTH-08 | Slow network login | No permanent stuck “Sign In” after success (await hydrate) | P1 |

### B. Find The Cars Of Your Choice (mobile)

| TC | Steps | Expected | Priority |
|----|--------|----------|----------|
| TC-FC-01 | Home @360px — Find Cars section | No horizontal page overflow; tabs usable | **P0** |
| TC-FC-02 | Swipe/scroll tabs | All 5 tabs reachable | P0 |
| TC-FC-03 | Tap each tab | Pills update; pills wrap; tappable ≥44px | P0 |
| TC-FC-04 | Title + card padding | Readable; padding ≤1rem on phone; not overlapping bottom nav | P1 |
| TC-FC-05 | Playwright `scrollWidth <= clientWidth+2` on `/` | PASS including Find Cars | P1 |

### C. Regression (prior fixes)

| TC | Area | Expected |
|----|------|----------|
| TC-LAY-01 | Notch device | Navbar clears status bar |
| TC-LAY-02 | `/compare` @390 | Table scrolls horizontally; text readable |
| TC-LAY-03 | Brands | 2 cols @480 |
| TC-LAY-04 | Used Cars filters | Bottom sheet opens/closes |
| TC-LAY-05 | Budget slider | Thumbs aligned on track |
| TC-SEC-01 | `GET /diagnosis/{id}` unauthenticated | 401 |
| TC-SEC-02 | Android backup | `allowBackup=false` |

---

## 6. Gaps still open (priority list)

1. **AUTH-01** — Bottom nav Account not auth-aware / no logout  
2. **FC-01/02/03** — Find Cars mobile layout  
3. **AUTH-03** — login hydrate race  
4. **AUTH-02** — bottom nav safe-area  
5. **FC-04** — content vs bottom nav overlap  
6. LAY-005 residual overflow-x  
7. Runtime Appium/device lab still not executed in this environment  

---

## 7. Claude fix prompts

See `Claude_Fix_AUTH_FindCars.md` (ready to paste).

---

## 8. Artifacts

- `docs/qa/mobile/revalidate-after-fixes.json`  
- `docs/qa/mobile/Claude_Fix_AUTH_FindCars.md`  
- This report  

**Recommendation:** Fix AUTH-01 + Find Cars **before** more feature waves — these are daily-path UX breakages on the APK.
