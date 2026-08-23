import { test, expect, Page } from '@playwright/test';

/**
 * Smoke tests — does the app still work at all?
 *
 * Narrow on purpose. These do not check that a feature is correct; they check
 * that a page renders, that its main content appears, and that nothing threw on
 * the way. That is the failure this repo keeps hitting: a change compiles, the
 * unit tests pass, and a page is blank or broken in a way only a browser sees.
 *
 * Every assertion here would have caught something that actually shipped:
 *   - a gallery that rendered no images
 *   - a heading hidden underneath the fixed navbar
 *   - a checkbox stretched to the full width of its row
 *   - a console error from a component that failed to initialise
 *
 * They run without an API. The app falls back to demo data when the catalogue
 * cannot be reached, so these must pass offline — a smoke test that needs a
 * live backend is one that gets disabled the first time the backend is down.
 */

/** Errors that say nothing about our code — a missing backend, mostly. */
const IGNORABLE = [
  /Failed to load resource/i,
  /ERR_CONNECTION_REFUSED/i,
  /ERR_NAME_NOT_RESOLVED/i,
  /net::ERR_/i,
  /Catalogue source failed/i,
  /falling back to demo data/i,
  /supabase/i,
];

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (!IGNORABLE.some(pattern => pattern.test(text))) errors.push(text);
  });
  page.on('pageerror', err => errors.push(String(err)));
  return errors;
}

/** Every page in the app is expected to render these. */
async function expectChrome(page: Page) {
  // `nav`, not `app-navbar`: the component host is a zero-height wrapper around
  // the fixed bar, and Playwright rightly calls a zero-size element hidden.
  await expect(page.locator('nav').first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator('footer').first()).toBeVisible({ timeout: 20000 });
}

const PAGES = [
  { path: '/', name: 'home' },
  { path: '/listings', name: 'listings' },
  { path: '/car-loan', name: 'car loan' },
  { path: '/emi-calculator', name: 'EMI calculator' },
  { path: '/compare', name: 'compare' },
];

for (const { path, name } of PAGES) {
  test(`${name} renders`, async ({ page }) => {
    const errors = collectConsoleErrors(page);

    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), `${path} returned ${response?.status()}`).toBeLessThan(400);

    await expectChrome(page);

    // A heading, and one that is not empty — a page that renders its shell and
    // nothing else looks fine to `ng build` and broken to a person.
    const heading = page.locator('h1, h2').first();
    await expect(heading).toBeVisible({ timeout: 15000 });
    expect((await heading.innerText()).trim().length).toBeGreaterThan(2);

    // LAY-007: the navbar is fixed, so a page that forgets --nav-offset renders
    // its own title underneath it. Shipped at least once.
    const navBox = await page.locator('nav').first().boundingBox();
    const headBox = await heading.boundingBox();
    if (navBox && headBox) {
      expect(
        headBox.y,
        `${path}: heading starts at ${headBox.y}, navbar ends at ${navBox.y + navBox.height}`,
      ).toBeGreaterThanOrEqual(navBox.y + navBox.height - 1);
    }

    expect(errors, `console errors on ${path}:\n${errors.join('\n')}`).toEqual([]);
  });
}

test('no input is stretched to the width of its row', async ({ page }) => {
  // A global `input { width: 100% }` once applied to checkboxes too, which
  // pushed their labels clean out of the card they belonged to.
  for (const path of ['/car-loan', '/listings']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const widths = await page.$$eval(
      'input[type="checkbox"], input[type="radio"]',
      els => els.filter(e => (e as HTMLElement).offsetParent !== null)
                .map(e => e.getBoundingClientRect().width),
    );
    for (const width of widths) {
      expect(width, `${path}: a tick box is ${width}px wide`).toBeLessThan(40);
    }
  }
});

test('the car detail page shows a car and its gallery', async ({ page }) => {
  // The page that broke hardest: images resolve onto a car through a
  // make/model/year match, and a change to that filter emptied every gallery
  // on the site while every test still passed.
  const errors = collectConsoleErrors(page);

  // Straight to a car rather than clicking through /listings: with no API the
  // listing page legitimately shows nothing, and this test is about the detail
  // page. `d8001` is from the in-repo demo catalogue (cars-data.service.ts), so
  // it resolves offline; against a real API the page substitutes another car
  // and still has to render a gallery, which is what is being checked.
  await page.goto('/cars/d8001', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.gallery, .main-img').first()).toBeVisible({ timeout: 20000 });
  // At least one image element, and one that resolved to something.
  const images = page.locator('.main-img img');
  await expect(images.first()).toBeVisible();
  const box = await images.first().boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(50);

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});

/**
 * Every rendered icon draws something.
 *
 * icon.component resolves an unknown name to `ICONS[name] ?? ''` and renders
 * an empty <svg>. That is the right fallback — a typo should not blank the
 * page — but it fails silently in the worst way: the element is present, it
 * occupies its box, and it draws nothing. No console error, no build failure,
 * no layout shift.
 *
 * Four names shipped that way before this test existed — `users`, `scissors`
 * and `layers` on the insurance page, `grid` in the navbar — and two reached
 * production. An invisible icon beside a readable label looks like a
 * deliberately plain list, which is why nobody reported it.
 *
 * This checks the rendered DOM rather than the source. An earlier attempt
 * scanned the source from a unit test via require.context, which executed
 * every module it matched and hung the browser; and source-scanning could not
 * have caught a name assembled at runtime anyway.
 */
for (const path of ['/', '/insurance', '/track-challan', '/video-review', '/compare', '/emi-calculator']) {
  test(`every icon on ${path} draws a glyph`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('app-icon svg', { state: 'attached' });

    const empty = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll('app-icon'))) {
        const svg = el.querySelector('svg');
        if (!svg) continue;
        // A real glyph has at least one drawing element inside it.
        if (svg.querySelector('path, circle, rect, line, polyline, polygon')) continue;
        bad.push(
          (el.getAttribute('name') || '(no name attribute)') +
            ' near "' +
            (el.parentElement?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) +
            '"'
        );
      }
      return bad;
    });

    expect(
      empty,
      `These <app-icon> elements rendered an empty svg on ${path}:\n  ${empty.join('\n  ')}\n`
    ).toEqual([]);
  });
}

/**
 * The More menu actually appears when clicked.
 *
 * WHY THIS ASSERTS elementFromPoint AND NOT toBeVisible()
 *
 * This shipped broken. The panel lived inside .nav-ai-inner, which scrolls
 * horizontally — and an element with `overflow-x: auto` clips on both axes,
 * because the other axis computes to `auto` too. The panel rendered below the
 * row, was clipped to the row's height, and was invisible on screen.
 *
 * Every cheap check passed anyway. The markup was in the DOM, so
 * textContent found the items. Layout ran normally, so boundingBox() returned
 * a real rectangle. Even Playwright's toBeVisible() passes: it means "has a
 * non-empty box and is not visibility:hidden", which a clipped element still
 * satisfies.
 *
 * The only question that distinguishes clipped from visible is "if a user
 * clicked the middle of this panel, would they hit it?" — which is what
 * elementFromPoint answers, and what a person reporting "no response" was
 * actually describing.
 */
for (const path of ['/', '/ai-valuation']) {
  test(`the More menu opens and is clickable on ${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ai-tab-more');
    await page.click('.ai-tab-more');

    const panel = page.locator('.ai-more .nav-mega');
    await expect(panel).toBeVisible();

    const hit = await page.evaluate(() => {
      const el = document.querySelector('.ai-more .nav-mega') as HTMLElement | null;
      if (!el) return { ok: false, why: 'panel not in the DOM' };
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { ok: false, why: 'panel has no box' };

      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      if (!top) return { ok: false, why: 'nothing at the panel centre — off-screen or clipped' };
      return {
        ok: el.contains(top) || el === top,
        why: `the element at the panel centre is <${top.tagName.toLowerCase()} class="${top.className}">`,
      };
    });
    expect(hit.ok, `More panel on ${path} is not hittable: ${hit.why}`).toBe(true);

    // And it goes somewhere — specifically, where the item it clicked says.
    //
    // This used to click .first() and wait for '**/track-challan', which
    // encoded the order of the menu rather than the behaviour under test.
    // Adding "Post a Video Review" above Track Challan turned it red on a
    // working menu. Reading the destination off the link's own routerLink
    // asserts the same thing — the item navigates where it points — and
    // survives the next item anybody adds.
    const firstItem = page.locator('.ai-more .nav-mega-item').first();
    const href = await firstItem.getAttribute('href');
    expect(href, 'the first More item should be a real link').toBeTruthy();
    await firstItem.click();
    await page.waitForURL(`**${href}`);
  });
}
