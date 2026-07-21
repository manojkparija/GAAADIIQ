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
