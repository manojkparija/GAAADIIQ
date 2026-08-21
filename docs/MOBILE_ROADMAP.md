# Mobile app roadmap

## What the app is

A **Capacitor** shell (`com.gaadiiq.app`) wrapping the Angular web app. One
codebase, one deploy, all 46 routes.

`docs/MVPRoadmap.md` still plans a **React Native** app for Q3. That is out of
date — the Capacitor app already exists and ships an APK from CI on every push
(`.github/workflows/build-apk.yml`). Plan from this file for anything mobile.

## Feature parity: already there

Every route is reachable on a phone. The only four `hide-mobile` uses are
navbar controls the mobile drawer duplicates — city picker, theme toggle,
sign-in — all verified present in the drawer.

So the question is not *which features are missing*. It is **how much the app
behaves like an app** rather than a website in a shell.

## The actual gap

`NativeService` wraps eight native capabilities. Before this roadmap it was
injected in exactly one file — `app.component.ts` — which called only
`registerPush()` and a root-detection check.

| Capability | Wrapped | Used by a feature |
|---|---|---|
| `takePhoto()` | ✅ | ✅ List Your Car *(done)* |
| `pickPhoto()` | ✅ | ✅ List Your Car *(done)* |
| `getCurrentPosition()` | ✅ | ✅ Find a Mechanic *(done)* |
| `getPreference()` / `setPreference()` | ✅ | ❌ |
| `registerPush()` | ✅ | ⚠️ registers a token; nothing sends to it |

Everything was built. Almost none of it was connected.

---

## Phase 1 — Make it behave like an app

### 1.1 Camera on List Your Car ✅ done

Was `<input type="file">`, which opens a file browser. A seller listing a car is
standing next to it; the camera is the first step, not a folder of photos they
have not taken.

Native shell gets **Take photo** / **Choose from gallery**; the web keeps the
file input unchanged. Both paths converge on `ImageUploadService.uploadFiles`
via `NativeService.photoToFile`, so limits and error handling do not fork.

### 1.2 GPS on Find a Mechanic ✅ done

**An earlier draft of this file said the feature "asks a stranded driver to pick
their city". That was wrong.** Find a Mechanic already took a live fix through
`MarketplaceService.currentPosition()`, and already refused to fall back to a
city centre — a silently wrong position is worse than no position when the point
is dispatching to where the car actually stopped.

The real defect was narrower and only bites on a phone. Every call site used
`navigator.geolocation`, which **inside a WebView never triggers Android's
runtime permission request**. `ACCESS_FINE_LOCATION` is declared in
`AndroidManifest.xml`, but on Android 6+ declaring is not granting, and nothing
in the app asked. So the fix failed and the driver was told "Location access was
blocked" — about a permission they had never been offered.

`currentPosition()` now goes through the Capacitor plugin in the native shell,
which asks first. The browser path is untouched.

A second bug in the wrapper, found on the way: it requested permission only when
the state was `'denied'`. A fresh install reports `'prompt'`, so the request was
skipped in exactly the case that mattered.

**Still using `navigator.geolocation` directly:** `city-selector` and
`vehicle-diagnosis`. Same latent problem, lower stakes — both already degrade to
a chosen city.

### 1.3 Dealer photo upload

Same camera treatment as 1.1 for the dealer dashboard's image upload. Deferred
only because the dealer flow itself has not yet been verified end-to-end against
real Supabase auth.

### 1.4 Remember the last city — withdrawn

An earlier draft claimed city choice "resets every launch". **Not demonstrated,
and probably false**: `CityService` persists to `localStorage`, which survives
app restarts in a Capacitor WebView.

`Preferences` is more durable — WebView storage can be cleared by Android under
storage pressure, native preferences are not — but that is a robustness
improvement, not the bug this item described. Left undone rather than fixed on a
claim nobody checked.

**A note on this file.** Three of its original items did not survive being
checked: Find a Mechanic already had GPS, city already persists, and the real
location defect was a missing Android runtime permission request rather than a
missing feature. It was written from a fast read of the code. Verify before
building from any remaining item here.

## Phase 2 — Feel

Deliberately after Phase 1: native camera and location are what make an app feel
native. A prettier web form is still a web form.

- **Haptics** on submit, valuation complete, listing published.
  `@capacitor/haptics` is not installed yet.
- **Splash screen and adaptive icon.** Currently defaults.
- **Native share** for a listing — the web share sheet is not the OS one.
- **Offline shell** — a saved listing draft surviving a tunnel.

## Phase 3 — Reach

- **Push that sends something.** `registerPush()` collects a token; no backend
  sends to it. Price-drop alerts and enquiry notifications are the obvious
  first two, and both already exist as server-side concepts.
- **Play Store listing** — signing config in `capacitor.config.ts` is all
  `undefined`, so CI builds a debug APK only. Release signing is a prerequisite
  for any store submission.

---

## Not verified

Nobody has run the APK on a physical device as part of this work. Everything
above is read from the code and reasoned about. The visual quality of the
installed app — splash, icon, transitions, how the web views feel under a thumb
— is unassessed, and Phase 2 should start with someone actually looking at it.
