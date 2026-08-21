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
| `getCurrentPosition()` | ✅ | ❌ **Find a Mechanic still asks for a city** |
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

### 1.2 GPS on Find a Mechanic — next

The roadside-help feature asks a stranded driver to pick their city from a
dropdown while the device knows where they are. `getCurrentPosition()` exists
and is unused.

Needs a reverse-geocode to a city, and must degrade to the manual picker when
permission is refused — location is the one permission users decline most, and
refusing it should not remove the feature.

### 1.3 Dealer photo upload

Same camera treatment as 1.1 for the dealer dashboard's image upload. Deferred
only because the dealer flow itself has not yet been verified end-to-end against
real Supabase auth.

### 1.4 Remember the last city

`setPreference()` is unused, so city choice resets every launch. Small, and the
kind of thing that separates an app from a bookmark.

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
