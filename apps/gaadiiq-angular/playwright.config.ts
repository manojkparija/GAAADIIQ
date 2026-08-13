import { defineConfig, devices } from '@playwright/test';

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
    // Allows pointing at a Chromium that Playwright did not download itself.
    //
    // Needed wherever the pinned @playwright/test expects a browser build the
    // machine does not have — a sandbox or CI image that ships its own
    // Chromium, for instance. Without it the run fails at launch with
    // "Executable doesn't exist", which looks exactly like seven failing tests
    // rather than a browser that never started.
    //
    // Unset by default, so normal runs and CI are untouched.
    launchOptions: process.env['PLAYWRIGHT_CHROMIUM_PATH']
      ? { executablePath: process.env['PLAYWRIGHT_CHROMIUM_PATH'] }
      : {},
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
      testMatch: /(smoke|contrast)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } },
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
      },
    },
    {
      name: 'mobile-412',
      testMatch: /mobile-layout\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 412, height: 915 },
      },
    },
  ],
});
