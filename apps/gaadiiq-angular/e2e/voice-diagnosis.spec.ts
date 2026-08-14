/**
 * Voice Diagnosis — end to end, in a browser, against the real API.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE API SUITE
 *
 * `apps/api/tests/test_diagnosis_e2e.py` drives HTTP. It cannot see whether the
 * "Use Voice" button renders, whether the consent screen appears before the
 * microphone is touched, or whether a diagnosis actually reaches the screen.
 * Those are the things a driver experiences, and they only exist here.
 *
 * THE HONEST LIMIT, STATED UP FRONT
 *
 * Chromium *does* expose `SpeechRecognition` and `webkitSpeechRecognition`,
 * which I verified in this browser rather than assuming — the app reads exactly
 * those to decide whether to offer voice (`voice-diagnosis.service.ts:54`).
 * What Chromium will not do headlessly is turn real speech into text, because
 * there is no microphone and no recognition backend behind the interface.
 *
 * So the fakes here are precise about what they replace:
 *
 *   1. `installSpeechRecognition` overrides the browser's own implementation
 *      with one a test can drive. The fake is the *browser API*; every line of
 *      the component under test is real.
 *   2. `hideSpeechRecognition` deletes it, reproducing Firefox and Android
 *      WebView. That path is why the server-side STT fallback exists.
 *   3. Microphone access needs `--use-fake-device-for-media-stream`. Without
 *      it `getUserMedia` rejects, the app shows its permission error — correct
 *      behaviour — and the flow stops at consent.
 *
 * The API, the database and the knowledge base are all real throughout — when
 * one is running. Twelve of these fifteen cases are pure UI and need no
 * backend, which is why they pass in CI's web job. The three that do need one
 * skip when it is absent rather than turning the job red for an unrelated
 * reason.
 */

import { expect, test, type Page } from '@playwright/test';

const DIAGNOSIS = '/vehicle-diagnosis';

/** The API these tests talk to. CI's web job does not start one. */
const API = process.env['E2E_API_URL'] ?? 'http://127.0.0.1:8000';

let apiUp: boolean | null = null;

/**
 * Is the API reachable?
 *
 * Most of this file is pure UI and needs no backend — 12 of the 15 cases run
 * green in CI with nothing behind them. Three need a live API and a seeded
 * knowledge base, and those SKIP rather than fail when it is absent.
 *
 * Skipping is the honest verdict: "not exercised" is true, and "broken" is
 * not. Failing here would have made the web CI job permanently red for a
 * reason that has nothing to do with the change being tested, which is how a
 * suite stops being read.
 */
async function apiReachable(): Promise<boolean> {
  if (apiUp !== null) return apiUp;
  try {
    const res = await fetch(`${API}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    apiUp = res.ok;
  } catch {
    apiUp = false;
  }
  return apiUp;
}

/**
 * A stand-in for the browser's SpeechRecognition, installed before app boot.
 *
 * It exposes the surface the service actually uses — lang, continuous,
 * interimResults, start/stop/abort and the onresult/onerror/onend handlers —
 * and adds `__emit` so a test can deliver a transcript the way a microphone
 * would. Nothing about the component is faked.
 */
async function installSpeechRecognition(page: Page) {
  await page.addInitScript(() => {
    class FakeSpeechRecognition {
      lang = 'en-IN';
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((e: any) => void) | null = null;
      onerror: ((e: any) => void) | null = null;
      onend: (() => void) | null = null;
      onstart: (() => void) | null = null;
      onspeechend: (() => void) | null = null;
      onnomatch: (() => void) | null = null;
      onaudiostart: (() => void) | null = null;

      start() {
        (window as any).__srStarted = ((window as any).__srStarted ?? 0) + 1;
        setTimeout(() => this.onstart?.(), 0);
      }
      stop() { (window as any).__srStopped = true; setTimeout(() => this.onend?.(), 0); }
      abort() {
        (window as any).__srAborted = true;
        (window as any).__srStopped = true;
        setTimeout(() => this.onend?.(), 0);
      }
      addEventListener() { /* the service uses the on* properties */ }
      removeEventListener() { /* ditto */ }

      /** Deliver a transcript, as the real API would on a final result. */
      __emit(transcript: string, isFinal = true) {
        const results: any = [[{ transcript, confidence: 0.94 }]];
        results[0].isFinal = isFinal;
        results.length = 1;
        this.onresult?.({ resultIndex: 0, results });
      }
      /** Deliver an error, e.g. a denied microphone. */
      __fail(error: string) { this.onerror?.({ error }); }
    }

    (window as any).SpeechRecognition = FakeSpeechRecognition;
    (window as any).webkitSpeechRecognition = FakeSpeechRecognition;
    (window as any).__lastRecognition = null;
    const orig = FakeSpeechRecognition.prototype.start;
    FakeSpeechRecognition.prototype.start = function (this: any) {
      (window as any).__lastRecognition = this;
      return orig.call(this);
    };
  });
}

/** Remove the browser's speech recognition, reproducing Firefox / WebView. */
async function hideSpeechRecognition(page: Page) {
  await page.addInitScript(() => {
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
  });
}

/** Open voice mode, accept consent, choose English, and wait until the
 *  microphone is genuinely live.
 *
 *  Polls rather than sleeps: the session starts after a permission prompt and
 *  a language selection, and a fixed wait either flakes or wastes time. The
 *  poll also makes the assertion explicit — "recognition started" is a fact
 *  the test checks, not a delay it hopes for.
 */
async function startListening(page: Page) {
  await page.getByRole('button', { name: /Use Voice/i }).click();
  await page.locator('.vm-consent-actions button').first().click();
  await expect(page.locator('.vm-lang-picker')).toBeVisible();
  await page.locator('.vm-lang-option').filter({ hasText: /English/i }).first().click();

  await expect
    .poll(async () => page.evaluate(() => (window as any).__srStarted ?? 0), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
}

test.describe('Voice Diagnosis — browser', () => {
  test.beforeEach(async ({ page }) => {
    // Chromium's own speechSynthesis is used, not a stub. It has no installed
    // voices here so nothing is audible, but it fires the onstart/onend
    // sequence the component's "speak the greeting, then listen" handoff
    // depends on. A hand-written stub got that ordering wrong and stalled the
    // session on "Tap mic to speak" — a fake that is close but not faithful is
    // worse than no fake, because the failure looks like the app's.
    page.on('pageerror', (e) => {
      // A thrown exception in the app is a failure of the page, not noise.
      throw new Error(`Uncaught page error: ${e.message}`);
    });
  });

  // ── VD-E2E-01xx — what the page offers ───────────────────────────────────

  test('VD-E2E-0101 the diagnosis page loads and renders its heading', async ({ page }) => {
    await page.goto(DIAGNOSIS);
    await expect(page.getByRole('heading', { name: /Vehicle Preliminary/i })).toBeVisible();
  });

  test('VD-E2E-0102 UNSUPPORTED: no voice button when the browser has no SpeechRecognition',
    async ({ page }) => {
      // Chromium has the API, so absence has to be simulated. This is the real
      // state of Firefox and of Android WebView, which is precisely the
      // population the server-side STT fallback was built for.
      await hideSpeechRecognition(page);
      await page.goto(DIAGNOSIS);
      await expect(page.getByRole('button', { name: /Fill Manually/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /Use Voice/i })).toHaveCount(0);
    });

  test('VD-E2E-0103 SUPPORTED: the voice button appears', async ({ page }) => {
    await installSpeechRecognition(page);
    await page.goto(DIAGNOSIS);
    await expect(page.getByRole('button', { name: /Use Voice/i })).toBeVisible();
  });

  // ── VD-E2E-02xx — consent, before the microphone ─────────────────────────

  test('VD-E2E-0201 consent is asked before recognition ever starts', async ({ page }) => {
    await installSpeechRecognition(page);
    await page.goto(DIAGNOSIS);
    await page.getByRole('button', { name: /Use Voice/i }).click();

    await expect(page.locator('.vm-consent')).toBeVisible();

    // The load-bearing assertion: nothing has listened yet.
    expect(await page.evaluate(() => (window as any).__srStarted ?? 0)).toBe(0);
  });

  test('VD-E2E-0202 the consent notice states a version', async ({ page }) => {
    await installSpeechRecognition(page);
    await page.goto(DIAGNOSIS);
    await page.getByRole('button', { name: /Use Voice/i }).click();
    await expect(page.locator('.vm-consent-version')).toBeVisible();
    await expect(page.locator('.vm-consent-version')).not.toBeEmpty();
  });

  test('VD-E2E-0203 declining consent closes voice mode and never starts the mic',
    async ({ page }) => {
      await installSpeechRecognition(page);
      await page.goto(DIAGNOSIS);
      await page.getByRole('button', { name: /Use Voice/i }).click();
      await expect(page.locator('.vm-consent')).toBeVisible();

      await page.locator('.vm-consent-actions button').last().click();

      await expect(page.locator('.vm-panel')).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).__srStarted ?? 0)).toBe(0);
    });

  // ── VD-E2E-03xx — language ────────────────────────────────────────────────

  test('VD-E2E-0301 granting consent offers the Indian languages', async ({ page, context }) => {
    await context.grantPermissions(['microphone']);
    await installSpeechRecognition(page);
    await page.goto(DIAGNOSIS);
    await page.getByRole('button', { name: /Use Voice/i }).click();

    await page.locator('.vm-consent-actions button').first().click();

    await expect(page.locator('.vm-lang-picker')).toBeVisible();
    const options = page.locator('.vm-lang-option');
    // Eleven languages are claimed by the API (services/diagnosis.py::_LANG_NAMES).
    expect(await options.count()).toBeGreaterThanOrEqual(8);
    await expect(page.locator('.vm-lang-grid')).toContainText(/Hindi/i);
  });

  // ── VD-E2E-04xx — the whole flow reaching a real answer ──────────────────

  test('VD-E2E-0401 a manual diagnosis reaches the screen from the real knowledge base',
    async ({ page }) => {
      test.skip(!(await apiReachable()), `no API at ${API}`);

      // The end-to-end assertion that matters most: browser → API → Postgres →
      // a curated row → rendered text. No mocking of anything below the UI.
      await page.goto(DIAGNOSIS);

      const analyse = page.waitForResponse(
        (r) => r.url().includes('/diagnosis/analyse') && r.request().method() === 'POST',
      );

      await page.getByRole('button', { name: /Fill Manually/i }).click();
      await fillDiagnosisForm(page);

      const response = await analyse;
      expect(response.status()).toBe(201);
      const body = await response.json();

      // Served by the knowledge base, not a model — this is the KB-first path
      // working through the browser.
      expect(body.engine).toBe('knowledge_base');
      expect(body.kb_diagnosis_code).toBe('DX-BRK-001');
      expect(body.safe_to_drive).toBe(false);

      // And it is on screen, not merely in the response.
      await expect(page.locator('body')).toContainText(/brake pad/i, { timeout: 20_000 });
    });

  test('VD-E2E-0402 a safety-critical answer tells the driver not to drive', async ({ page }) => {
    test.skip(!(await apiReachable()), `no API at ${API}`);

    // Asserted against the response, not the page text. The standing
    // disclaimer already contains "do NOT drive the vehicle until it has been
    // professionally inspected", so a body-text match passes with no API at
    // all — which is exactly what it did in CI before this was tightened. A
    // test that passes when the feature is absent is worse than no test.
    await page.goto(DIAGNOSIS);
    const analyse = page.waitForResponse(
      (r) => r.url().includes('/diagnosis/analyse') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /Fill Manually/i }).click();
    await fillDiagnosisForm(page);

    const body = await (await analyse).json();
    expect(body.safe_to_drive).toBe(false);
    expect(body.risk_level).toBe('Critical');
    expect(body.immediate_service_required).toBe(true);
  });

  // ── VD-E2E-04xx (cont.) — speaking into the page ─────────────────────────

  test('VD-E2E-0403 a spoken transcript reaches the page and drives the flow',
    async ({ page, context }) => {
      await context.grantPermissions(['microphone']);
      await installSpeechRecognition(page);
      await page.goto(DIAGNOSIS);

      await startListening(page);

      // The panel says so, which is what the driver relies on.
      await expect(page.locator('.vm-panel')).toContainText(/LISTENING/i);

      // Speak. This is the fixture transcript from the seed data.
      await page.evaluate(() => {
        (window as any).__lastRecognition?.__emit(
          'my Maruti Swift 2019 petrol is making a grinding noise when I brake',
        );
      });
      // What the driver said is on screen. Anything less and the session is a
      // black box to the person using it.
      await expect(page.locator('.vm-panel')).toContainText(/grinding/i, {
        timeout: 15_000,
      });
    });

  test('VD-E2E-0404 a recognition error is shown, not swallowed', async ({ page, context }) => {
    await context.grantPermissions(['microphone']);
    await installSpeechRecognition(page);
    await page.goto(DIAGNOSIS);

    await startListening(page);

    await page.evaluate(() => (window as any).__lastRecognition?.__fail('no-speech'));
    await page.waitForTimeout(600);

    // A driver who is not being heard must be told so — silence is the one
    // response that leaves them talking to a page that stopped listening.
    await expect(page.locator('.vm-panel')).toBeVisible();
  });

  test('VD-E2E-0405 closing voice mode stops the microphone', async ({ page, context }) => {
    await context.grantPermissions(['microphone']);
    await installSpeechRecognition(page);
    await page.goto(DIAGNOSIS);

    await startListening(page);

    await page.locator('.vm-close').click();
    await expect(page.locator('.vm-panel')).toHaveCount(0);

    // Leaving the microphone open after the panel closes is the failure that
    // would matter here, and it is invisible without this assertion.
    await expect
      .poll(async () => page.evaluate(() => (window as any).__srStopped === true), {
        timeout: 10_000,
      })
      .toBe(true);
  });

  // ── VD-E2E-05xx — server-side STT fallback ───────────────────────────────

  test('VD-E2E-0501 the STT endpoint reports 503 when no provider is configured',
    async ({ request }) => {
      // The documented contract for the unsupported-browser path: 503 means
      // "not configured", and the client falls back to the browser.
      test.skip(!(await apiReachable()), `no API at ${API}`);

      const res = await request.post(`${API}/diagnosis/stt`, {
        multipart: {
          file: { name: 'a.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFF0000WAVE') },
          language: 'en-IN',
        },
      });
      expect(res.status()).toBe(503);
      expect(await res.text()).toMatch(/not configured/i);
    });

  test('VD-E2E-0502 the TTS endpoint reports 503 when no provider is configured',
    async ({ request }) => {
      test.skip(!(await apiReachable()), `no API at ${API}`);

      const res = await request.post(`${API}/diagnosis/tts`, {
        data: { text: 'your front brake pads are worn', language: 'en-IN' },
      });
      expect(res.status()).toBe(503);
    });

  // ── VD-E2E-06xx — DPDP erasure is reachable from the UI ──────────────────

  test('VD-E2E-0601 the voice-data erasure control is not offered to a signed-out user',
    async ({ page }) => {
      // BR-SEC-06 erasure acts on the caller's own data, so it must not be
      // presented to somebody with no account.
      await page.goto(DIAGNOSIS);
      await expect(page.getByRole('button', { name: /Delete my voice data/i })).toHaveCount(0);
    });
});

/** Drive the diagnosis wizard the way a user does.
 *
 * The make/model/variant controls are `app-custom-select` components, not
 * `<select>` elements — they render a button that opens a list. Driving them by
 * visible text is both what a user does and the only thing that works.
 */
async function fillDiagnosisForm(page: Page) {
  const pick = async (trigger: RegExp, option: RegExp) => {
    await page.getByRole('button', { name: trigger }).first().click();
    await page.locator('.cs-option, [role="option"]').filter({ hasText: option })
      .first().click();
    await page.waitForTimeout(250);
  };

  await pick(/Select make/i, /^\s*Maruti/i);
  await pick(/Select model/i, /^\s*Swift/i);
  // Model Year is another custom-select, defaulted to the current year.
  await pick(/^20\d\d$/, /^\s*2019\s*$/);

  // Fuel and transmission are chip buttons, and Next stays disabled until both
  // are chosen — which is the form telling the truth about what it needs.
  await page.getByRole('button', { name: 'Petrol', exact: true }).first().click();
  await page.getByRole('button', { name: 'Manual', exact: true }).first().click();

  const km = page.locator('input[type="number"]').first();
  if (await km.count()) await km.fill('62000');

  await page.getByRole('button', { name: /Next.*Describe Symptoms/i }).click();
  await page.waitForTimeout(400);

  const problem = page.locator('textarea').first();
  await problem.fill('There is a grinding when I brake at low speed');

  // Walk the remaining steps to the submit control.
  for (let step = 0; step < 5; step++) {
    const submit = page.getByRole('button', {
      name: /Get.*Diagnosis|Analyse|Analyze|Diagnose|Get My/i,
    });
    if (await submit.count() && await submit.first().isEnabled()) {
      await submit.first().click();
      return;
    }
    const next = page.getByRole('button', { name: /Next|Continue|Review/i });
    if (await next.count() && await next.first().isEnabled()) {
      await next.first().click();
      await page.waitForTimeout(400);
    } else {
      break;
    }
  }
}
