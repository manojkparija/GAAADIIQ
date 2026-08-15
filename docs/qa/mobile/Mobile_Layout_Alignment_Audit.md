# Mobile Layout / Alignment Audit

**Honest answer:** The prior production QA did **NOT** run device/viewport screenshot testing of alignment. It was mostly architecture/security/feature review. This addendum is a **static CSS + structure audit** of fit/overflow risks that explain “many things not fitting” on the Capacitor Android WebView.

**Viewport assumed:** 360×800 / 390×844 (common Android phones)  
**Branch basis:** Angular app under `apps/gaadiiq-angular`  
**Date:** 2026-07-21

---

## Verdict

**FAIL — mobile layout is desktop-first with incomplete phone adaptation.**  
Several screens will clip, squeeze, or force awkward horizontal scroll inside the WebView.

| Score | Value |
|------|------:|
| Mobile layout readiness | **35/100** |
| Safe-area / notch handling | **0/100** (none) |
| Phone breakpoint coverage | **Partial** |

---

## Confirmed fit problems (code evidence)

### LAY-001 — BLOCKER — No safe-area / notch insets (Capacitor)
**Problem:** Navbar is `position: fixed; top: 0` with **zero** `env(safe-area-inset-*)`. Viewport meta lacks `viewport-fit=cover`.  
**Result:** On notched phones / Android gesture bars, logo/hamburger sit under status bar; bottom CTAs can sit under nav gestures.  
**Files:** `src/index.html`, `navbar.component.scss`, `styles.scss`

### LAY-002 — CRITICAL — Compare table never collapses on phone
**Problem:** `.comp-header/.comp-row` stay `grid-template-columns: 120px repeat(3, 1fr)` even at `max-width: 768px`.  
**Result:** Three car columns + label column on ~360px → text crush / overflow. No horizontal scroll wrapper on the comparison grid itself.  
**File:** `pages/compare/compare.component.scss`

### LAY-003 — CRITICAL — AI Advisor comparison `min-width: 520px`
**Problem:** `.cmp-table { min-width: 520px }` forces horizontal scroll on phones (wrapper exists, but feels “broken” / cut off).  
**File:** `pages/ai-advisor/ai-advisor.component.scss`

### LAY-004 — HIGH — Home brands stay 4 columns on phones
**Problem:** At `max-width: 768px`, `.brands-grid` still `repeat(4, 1fr)`.  
**Result:** Tiny brand tiles, cramped tap targets.  
**File:** `pages/home/home.component.scss`

### LAY-005 — HIGH — Global `overflow-x: hidden` hides bugs
**Problem:** `body`/`html` use `overflow-x: hidden` instead of fixing overflowing children.  
**Result:** Content clipped with no scroll — users think UI is “cut off.”  
**File:** `styles.scss`

### LAY-006 — HIGH — Used/New Cars filter sidebar is `display:none` + weak drawer
**Problem:** Sidebar hidden below 960/900px; “Filters” opens `.open` but is not a full-screen bottom sheet with backdrop/safe padding.  
**Result:** Filters feel jammed / scroll trapped / not native-mobile.  
**Files:** `used-cars.component.scss`, `new-cars.component.scss`

### LAY-007 — HIGH — Fixed navbar overlap risk
**Problem:** Heroes use large top padding inconsistently (`5.5rem` home; other pages vary). No shared `--nav-offset` token including safe-area.  
**Result:** Page titles/CTAs can sit under fixed navbar on short phones.  
**Files:** multiple `*-hero` SCSS blocks

### LAY-008 — MEDIUM — Dealer dashboard / EMI / listings tables
**Problem:** Tables rely on `overflow-x: auto` with desktop column counts; mobile has no card-stack alternate layout.  
**Result:** “Doesn’t fit” → sideways scrolling tables.  
**Files:** `dealer-dashboard`, `emi-calculator`, `listings`, `admin-pricing`

### LAY-009 — MEDIUM — Budget dual-range slider thumb alignment
**Problem:** Dual range inputs height 4px, thumbs 18px, no WebKit `margin-top` centering; no z-index swap.  
**Result:** Knobs look misaligned / hard to drag (already reported).  
**File:** `used-cars.component.scss`

### LAY-010 — MEDIUM — Touch targets & nowrap chips
**Problem:** Many `white-space: nowrap` chips/buttons (`min-width: 130–160px`) in hero search rows; wrap breakpoints exist for used-cars @640 but not uniformly elsewhere.  
**Result:** Horizontal crowding in hero toolbars before wrap kicks in (640–960 gap).

### LAY-011 — LOW — 4-up grids without phone-1-col on some pages
**Problem:** Some marketing grids (how-it-works 4-col on valuation, etc.) may stay multi-column too long. Pricing is OK (1-col @600). About values/team OK @500.  
**File:** `ai-valuation.component.scss` (`.how-grid` 4-col — verify media queries)

### LAY-012 — LOW — No mobile layout regression suite
**Problem:** No Playwright/Appium screenshots at 360/390/412 widths for Angular Capacitor routes.  
**Result:** Fit regressions ship unnoticed.

---

## What WAS partially OK

- Viewport meta `width=device-width, initial-scale=1` exists  
- Navbar hamburger + mobile menu exist  
- Used Cars hero search stacks to column @640px; car grid → 1 col  
- Compare **slots** go 1-col @768 (table does not)  
- Pricing plans → 1 col @600  
- Footer → 1/2 col @768  

---

## Claude Code — Layout Fix Pack (paste this)

```
You are fixing GAADIIQ MOBILE LAYOUT / ALIGNMENT issues (LAY-001…012).
Read docs/qa/mobile/Mobile_Layout_Alignment_Audit.md.

CONTEXT
- Angular Capacitor WebView app: apps/gaadiiq-angular
- Phone targets: 360×800, 390×844, 412×915
- Do NOT regress Used Cars P0 filter logic.

IMPLEMENT IN ORDER

LAY-001 (BLOCKER)
- index.html viewport: add viewport-fit=cover
- styles.scss: define --safe-top/bottom/left/right from env(safe-area-inset-*)
- navbar: padding-top: max(0.6rem, var(--safe-top)); ensure content clears status bar
- main app content / fixed bottom bars: padding-bottom with --safe-bottom

LAY-002 (CRITICAL) — compare.component.scss
- On max-width 768px: change comparison from 4-column grid to horizontal scroll with min-width OR stack as card-per-car sections
- Prefer: .comparison-table { overflow-x: auto; -webkit-overflow-scrolling: touch } and keep readable min column widths; OR accordion layout on mobile
- Ensure labels remain readable; no crushed text

LAY-003 (CRITICAL) — ai-advisor comparison table
- Keep overflow-x auto but add sticky first column OR card layout under 480px; reduce min-width or provide mobile card compare

LAY-004 (HIGH) — home brands-grid
- @media (max-width: 768px) → 3 columns; @media (max-width: 480px) → 2 columns; min tap size 44px

LAY-005 (HIGH)
- Remove reliance on html/body overflow-x:hidden as the only fix; fix overflowing children; allow intentional scroll regions only

LAY-006 (HIGH) — used-cars + new-cars filter drawer
- Mobile: full-screen or 90vh bottom sheet, backdrop, close button, body scroll lock, safe-area padding
- Filters button sticky and always reachable

LAY-007 (HIGH)
- Create --nav-offset: calc(56px + var(--safe-top))
- All page heroes use padding-top: var(--nav-offset) consistently

LAY-008 (MEDIUM)
- For wide tables (EMI schedule, dealer bookings, listings): keep overflow-x auto AND add mobile card list alternative for primary rows

LAY-009 (MEDIUM)
- Fix dual-range WebKit thumb centering (margin-top) + dynamic z-index when thumbs overlap

LAY-010 / LAY-011
- Audit nowrap toolbars between 640–960; force column wrap earlier (max-width: 768)
- Valuation how-grid: 2-col tablet, 1-col phone

LAY-012
- Add Playwright (or Cypress) mobile screenshot smoke for Angular routes at 390×844: /, /used-cars, /new-cars, /compare, /ai-advisor, /emi-calculator, /vehicle-diagnosis (if present)
- Fail if document scrollWidth > clientWidth + 2px (horizontal overflow detector)

ACCEPTANCE
- No horizontal page overflow on 360/390 widths for listed routes (except intentional table scroll regions)
- Navbar clear of notch
- Compare readable on phone
- Filters usable as sheet
- Screenshots saved under /opt/cursor/artifacts/mobile-layout/

Deliver PR with before/after notes per LAY-ID.
```

---

## Single-issue prompts

Use the same Wave-0 master context from `Claude_Batch_Prompts.md`, then:

```
Implement ONLY LAY-00X from docs/qa/mobile/Mobile_Layout_Alignment_Audit.md.
Follow the Claude Layout Fix Pack acceptance for that ID.
```

---

## Recommended next step for you

1. Paste the **Layout Fix Pack** into Claude first (before more feature work) — users feel “broken app” from fit issues even when features work.  
2. After Claude ships CSS, re-run Playwright overflow detector on 390×844.  
3. Only then continue MOB-001…040 feature/security waves.
