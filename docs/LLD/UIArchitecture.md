# GAADIIQ.COM — UI Architecture

**Version:** 2.0
**Date:** 2026-08-14
**Framework:** Angular 17 · standalone components · signals · SCSS
**Status:** As-built, read off `apps/gaadiiq-angular` on the date above.

> **What changed from v1.0.** The previous version described a Next.js 14 App
> Router application: `.tsx` route files, ISR revalidation windows, Zustand,
> ShadCN. None of that exists. The application is Angular 17 with standalone
> components and signals, built by `ng build` and served by Vercel as a static
> SPA. Every section below has been rewritten from the code.

---

## 1. Rendering model

A single-page application. There is no per-route rendering strategy, no ISR and
no revalidation window — those were Next.js concepts and the table that listed
them described nothing that runs.

- **Build:** `ng build` produces a static bundle. Vercel serves it.
- **Routing:** client-side, `app.routes.ts`, lazy `loadComponent` per route.
- **Data:** fetched at runtime from the FastAPI service at
  `environment.apiUrl`. Nothing is baked in at build time.
- **SEO:** consequently limited to what a client-rendered SPA gives you. If
  server rendering is wanted for the catalogue pages, that is a real project
  and not a config flag — Angular SSR would need adding.

---

## 2. Routes

44 routes are declared in `src/app/app.routes.ts`, including the `**` fallback.

| Area | Routes |
|---|---|
| Catalogue | `/`, `/listings`, `/new-cars`, `/used-cars`, `/cars/:id`, `/compare` |
| Buying tools | `/emi-calculator`, `/car-loan`, `/ev-calculator`, `/tco`, `/ai-valuation`, `/buyer-journey`, `/pricing-plans` |
| Selling | `/list-car`, `/my-listings`, `/leads`, `/analytics`, `/dealer-dashboard` |
| Diagnosis & service | `/vehicle-diagnosis`, `/find-mechanic`, `/mechanic-dashboard`, `/mechanic-signup` |
| Editorial | `/reviews-news`, `/reviews-news/:category`, `/reviews-news/:category/:id`, `/reviews-news/:category/live/:index` |
| Account | `/login`, `/register`, `/profile`, `/reset-password`, `/notifications`, `/price-alerts`, `/test-drive` |
| Admin | `/admin/pricing`, `/admin/pdf-ingestion`, `/admin/variants`, `/admin/car-images` |
| Static | `/about`, `/brand-logos`, `/privacy-policy`, `/terms-of-service`, `/cookie-policy` |
| Assistant | `/ai-advisor` |

**Not yet built:** there is no route for the diagnosis knowledge-base review
queue. That API exists (`/admin/diagnosis-kb/review-queue`) and is driven over
HTTP today.

---

## 3. Directory structure

```
apps/gaadiiq-angular/src/app/
├── app.routes.ts            # 44 routes, lazy loadComponent
├── components/              # 13 shared components
│   ├── navbar/  footer/  car-card/  logo/  icon/
│   ├── chat-widget/  voice-mode/  service-request/
│   ├── city-selector/  custom-select/  body-type-icon/
│   ├── install-pwa/  wave3-search/
├── pages/                   # 43 route components
├── services/                # 34 services — HTTP + state
├── guards/                  # admin.guard  auth.guard  seller.guard
├── interceptors/            # auth.interceptor
├── directives/  utils/  data/
```

---

## 4. State management

**There is no store library.** No NgRx, no Zustand, no Redux. State lives in
injectable services as Angular signals — 15 services hold signal state today
(`cars-data.service.ts` is the largest example, exposing loading, failure and
derived-count signals).

One rule that has been broken twice and is worth stating plainly:

> `computed()` tracks **signal reads only**. A `computed()` over a plain class
> field bound with `ngModel` evaluates once and then reports a stale answer
> forever. Use a method instead.

---

## 5. HTTP and auth

`interceptors/auth.interceptor.ts` attaches the Supabase access token to every
request whose URL starts with `environment.apiUrl`.

> **Never set an `Authorization` header by hand.** It shadows the interceptor,
> and the resulting failure looks like an auth bug rather than a header bug.

Guards: `authGuard` (signed in), `adminGuard` (admin email list), `sellerGuard`
(dealer/seller routes). Admin screens sit behind `adminGuard`, which is why two
of them shipped with a layout fault nobody had seen in a browser — see §7.

---

## 6. Styling

SCSS with CSS custom properties defined in `src/styles.scss`. The theme tokens
that matter:

| Token | Light | Purpose |
|---|---|---|
| `--primary` | `#295EE0` | Brand blue |
| `--teal` | `#14B8A6` | Secondary accent |
| `--navy`, `--ink`, `--dark` | | Grounds |
| `--fill-dim`, `--divider`, `--text-muted` | | Surfaces and rules |
| `--*-ink` (`--success-ink`, `--warning-ink`, `--info-ink`, `--teal-ink`) | | **Text on a coloured tint.** Use these, not the brand colour. |

Two rules with history behind them:

- **Page content clears the fixed navbar** with
  `padding-top: max(7rem, var(--nav-offset))` (LAY-007). Both admin screens
  were missing it and rendered their own titles under the nav.
- **Contrast is measured on the page, not on a swatch.** Small text sits on a
  tint of its own hue over `--navy`, several points lower than the same colour
  on white: `--primary` measured 4.50:1 on a white card and 4.27:1 in an 11px
  badge. Light theme passes AA; dark still has roughly 20 failures from
  hardcoded hexes (`#2563EB`, `#1E40AF`) that predate the tokens.

---

## 7. Browser verification

`ng build` and a green unit suite do not tell you a page works.

Playwright is configured with four projects — `desktop-chrome`, `mobile-390`,
`mobile-360`, `mobile-412` — and `e2e/contrast.spec.ts` walks the rendered DOM
and fails under WCAG AA.

Two facts about it that are easy to get wrong:

- **Playwright never runs in CI.** Browser verification is manual, and it is the
  only thing that catches a class of bug `ng build` cannot.
- **Every project declares a `testMatch`.** A new spec whose filename matches no
  pattern runs nowhere and reports nothing — which looks exactly like passing.
