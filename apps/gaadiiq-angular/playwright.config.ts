import { defineConfig, devices } from '@playwright/test';

/**
 * Optional override pointing at a Chromium the machine already has.
 *
 * Needed wherever the pinned @playwright/test expects a browser build that is
 * not installed — a sandbox or CI image shipping its own Chromium. Without it
 * the run dies at launch with "Executable doesn't exist", which reads as a
 * screen full of failing tests rather than a browser that never started.
 *
 * Applied per-project rather than in the top-level `use`, and ONLY to the
 * Chromium ones. mobile-390 uses devices['iPhone 14'], which is WebKit —
 * handing WebKit a Chromium binary makes it launch and immediately die, so a
 * global override turned nine passing layout tests into nine failures that
 * looked like a layout regression.
 *
 * Unset by default, so normal runs and CI are untouched.
 */
// Microphone-dependent specs need a fake capture device: headless Chromium has
// no microphone, so getUserMedia rejects and the voice flow stops at the
// permission error — correct app behaviour, but it means the rest of the flow
// is unreachable without these flags.
const FAKE_MEDIA = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

const chromiumOverride = process.env['PLAYWRIGHT_CHROMIUM_PATH']
  ? { launchOptions: { executablePath: process.env['PLAYWRIGHT_CHROMIUM_PATH'], args: FAKE_MEDIA } }
  : { launchOptions: { args: FAKE_MEDIA } };

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry in CI only. A smoke test that fails twice is a real failure; one
  // that fails once is usually the dev server still waking up, and a flaky
  // suite gets ignored, which is the same as not having one.
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  // Serves the production build, not `ng serve`. The dev server compiles each
  // lazy route on first request, which is slow enough that the smoke suite
  // timed out on pages that were working — and the built artefact is what
  // actually ships. Assumes `npm run build` has already run.
  //
  // Skipped when PLAYWRIGHT_BASE_URL is set, so the suite can be pointed at a
  // dev server or a deployed preview instead.
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npm run serve:dist',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      // What CI runs. Desktop Chromium, because it is the one browser CI
      // installs and the smoke tests are about "does this page work at all"
      // rather than about a particular engine.
      name: 'desktop-chrome',
      // Every project here declares a testMatch, so a new spec file that is
      // not named by one runs nowhere and reports nothing — which looks
      // exactly like passing. Add new desktop specs to this pattern.
      // typography is safe to run here: it reads rendered type only and needs
      // no API. Verified by running the whole 26-route sweep locally with no
      // backend started at all — every route rendered its text.
      // listing-columns is safe to run here: it reads source files only, starts
      // no browser and needs no API.
      // theme-tokens joins listing-columns as a source-only check: no browser,
      // no API, and it catches a CSS variable nobody ever defined.
      testMatch: /(smoke|contrast|voice-diagnosis|typography|listing-columns|theme-tokens|admin-theme|nav-overflow|api-origin|dealer-dashboard|pwa-icons)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 }, ...chromiumOverride },
    },
    {
      name: 'mobile-390',
      testMatch: /mobile-layout\.spec\.ts/,
      use: {
        ...devices['iPhone 14'],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: 'mobile-360',
      testMatch: /mobile-layout\.spec\.ts/,
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 360, height: 800 },
        ...chromiumOverride,
      },
    },
    {
      name: 'mobile-412',
      testMatch: /mobile-layout\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 412, height: 915 },
        ...chromiumOverride,
      },
    },
  ],
});
