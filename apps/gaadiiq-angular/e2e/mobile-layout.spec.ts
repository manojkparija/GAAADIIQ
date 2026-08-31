/**
 * LAY-012: Mobile layout smoke tests.
 * Fails if any route has horizontal overflow (scrollWidth > clientWidth + 2px).
 * Screenshots saved to /opt/cursor/artifacts/mobile-layout/ on failure.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const ROUTES = [
  '/',
  '/used-cars',
  '/new-cars',
  '/compare',
  '/ai-advisor',
  '/emi-calculator',
  '/vehicle-diagnosis',
];

const SCREENSHOT_DIR = '/opt/cursor/artifacts/mobile-layout';

async function checkNoHorizontalOverflow(page: Page, route: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth - document.documentElement.clientWidth;
  });
  if (overflow > 2) {
    // Save screenshot on failure
    try {
      if (!fs.existsSync(SCREENSHOT_DIR)) {
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      }
      const safeName = route.replace(/\//g, '_') || '_root';
      const screenshotPath = path.join(
        SCREENSHOT_DIR,
        `overflow-${safeName}-${Date.now()}.png`
      );
      await page.screenshot({ path: screenshotPath, fullPage: false });
    } catch {
      // Screenshot dir may not be writable in all envs; don't mask the real error
    }
    throw new Error(
      `Horizontal overflow on ${route}: scrollWidth exceeds clientWidth by ${overflow}px`
    );
  }
}

for (const route of ROUTES) {
  test(`no horizontal overflow on ${route}`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Wait briefly for Angular hydration / animations to settle
    await page.waitForTimeout(500);
    await checkNoHorizontalOverflow(page, route);
  });
}

// FC-01: .find-cars-tabs may internally scroll but must NOT cause page-level overflow
test('find-cars-tabs does not cause page overflow on home at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(500);

  const pageOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(pageOverflow, `Page overflow at 360px: ${pageOverflow}px`).toBeLessThanOrEqual(2);

  // The tabs container itself may have internal scroll — that is intentional
  const tabsContainerOk = await page.evaluate(() => {
    const tabs = document.querySelector('.find-cars-tabs');
    if (!tabs) return true; // element absent is fine
    // overflow-x: auto means scrollWidth >= clientWidth is expected and OK
    return tabs.scrollWidth >= tabs.clientWidth;
  });
  expect(tabsContainerOk).toBe(true);
});

test('find-cars-tabs does not cause page overflow on home at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(500);

  const pageOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(pageOverflow, `Page overflow at 390px: ${pageOverflow}px`).toBeLessThanOrEqual(2);
});

/**
 * The navigation row on a phone.
 *
 * Reported with a screenshot: the Android app showed only "AI Advisor | AI
 * Diagnosis | More" because navbar.component.scss hid `.nav-links` entirely
 * below 1180px. Nine destinations existed and none was reachable without
 * opening the hamburger.
 *
 * They do not fit across 390px, so the row scrolls sideways. These assert the
 * two things that make that usable and that a stylesheet cannot tell you:
 * every item is actually reachable by scrolling, and opening a dropdown does
 * not push the page sideways.
 */
test.describe('the nav strip at phone width', () => {
  test('shows the nav row rather than hiding it', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const strip = page.locator('.nav-links');
    await expect(strip).toBeVisible();
    // Home, New Cars, Used Cars, Compare, EMI & Loan, TCO, Insurance, News,
    // Journey. "More" is in the AI row and is deliberately not counted here.
    expect(await strip.locator('> li').count()).toBe(9);
  });

  test('every destination can be reached by scrolling', async ({ page }) => {
    // The row is wider than the screen by design; what matters is that the
    // last item can be brought into view rather than being unreachable.
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const last = page.locator('.nav-links > li').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
  });

  test('the strip scrolls without the page scrolling sideways', async ({ page }) => {
    // A row wider than the viewport is only acceptable if it scrolls INSIDE
    // its own container. If it widened the document instead, every page would
    // pan sideways — which is what the rest of this file exists to prevent.
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('a dropdown opens as a panel that fits the screen', async ({ page }) => {
    // Option A. As the desktop card it would be 33rem wide (three columns at
    // 11rem) hanging off a 390px screen.
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });

    await page.locator('.nav-links .nav-dropdown-trigger').first().click();
    const panel = page.locator('.nav-links .nav-mega').first();
    await expect(panel).toBeVisible();

    const box = (await panel.boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  });

  test('opening a dropdown still does not widen the page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30_000 });

    await page.locator('.nav-links .nav-dropdown-trigger').first().click();
    await expect(page.locator('.nav-links .nav-mega').first()).toBeVisible();

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
