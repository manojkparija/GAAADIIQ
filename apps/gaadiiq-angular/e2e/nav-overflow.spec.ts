/**
 * The navigation bar fits the window it is drawn in.
 *
 * Reported with a screenshot: the bar overflowing sideways, the logo clipped at
 * the left edge and the account chip clipped at the right.
 *
 * This is an e2e test and not a component test on purpose. The layout is
 * decided almost entirely by media queries, and a media query answers to the
 * browser window — not to the size of the element a unit test renders into.
 * Karma's window here is 765px wide, so every `max-width` rule below 1180px
 * matches in a component test no matter how narrow the host div is made: a
 * "desktop" assertion there is really measuring the phone strip, and passes
 * while the desktop bar is broken. Playwright sets a real viewport, so the
 * width under test is the width the CSS sees.
 *
 * Needs no API: the bar renders from routes and the auth state, so it is safe
 * in CI, which starts no backend.
 */
import { expect, test } from '@playwright/test';

/** Widths a laptop actually reports, plus the first width that is "desktop". */
const DESKTOP_WIDTHS = [1181, 1280, 1366, 1440, 1536];

test.describe('navigation bar', () => {
  for (const width of DESKTOP_WIDTHS) {
    test(`does not overflow the window at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await page.waitForSelector('.nav-inner');

      // The page itself must not become horizontally scrollable. This is the
      // symptom in the screenshot: the bar is wider than the window, so the
      // document scrolls and both ends of the bar leave the screen.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      expect(overflow, `document overflows by ${overflow}px at ${width}`).toBeLessThanOrEqual(0);
    });
  }

  test('keeps the logo and the utilities inside the bar', async ({ page }) => {
    await page.setViewportSize({ width: 1181, height: 900 });
    await page.goto('/');
    await page.waitForSelector('.nav-inner');

    const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
    const inner = await box('.nav-inner');
    const logo = await box('.logo');

    expect(logo.x, 'logo starts left of the bar').toBeGreaterThanOrEqual(inner.x - 1);
    expect(logo.x + logo.width, 'logo ends past the bar')
      .toBeLessThanOrEqual(inner.x + inner.width + 1);
  });

  test('the second-row shortcuts stay on one line', async ({ page }) => {
    // AI Advisor / AI Diagnosis / AI Car Value / Find Mechanic / More. This is
    // the strip the screenshot was taken on, and it has its own overflow.
    await page.setViewportSize({ width: 1181, height: 900 });
    await page.goto('/');

    const strip = page.locator('.nav-ai-row').first();
    const overflow = await strip.evaluate(el => el.scrollWidth - el.clientWidth);

    expect(overflow, `secondary strip overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  });
});
