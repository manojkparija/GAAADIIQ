/**
 * No two controls in the navigation bar are drawn on top of each other.
 *
 * WHAT THIS PREVENTS COMING BACK
 *
 * Reported twice with a screenshot: "English" painted over "News", the city
 * pill over "Journey". The bar looked like two layouts printed on the same
 * strip of paper.
 *
 * WHY nav-overflow.spec.ts DID NOT CATCH IT
 *
 * That spec asks whether the document scrolls sideways. It never did. The
 * measured cause:
 *
 *     logo 196 + links 829 (natural) + utils 368 = 1393, + 2 x 1rem gap = 1425
 *
 * `.nav-links` carries `min-width: 0`, and its children are inline-flex with
 * no wrapping. Below 1425px the ul is squeezed narrower than its own content,
 * and the links paint outside their box — over `.nav-utils`, which holds its
 * ground with `flex-shrink: 0`. Nothing overflows the document, so a test
 * that only measures the document is blind to it by construction. The links
 * reached their natural width only at 1500px, which left 1280, 1366 and 1440
 * — the three commonest laptops — all drawing an overlapping bar, and a green
 * suite throughout.
 *
 * So this test measures the thing that was actually wrong: pairwise geometry
 * between the controls a reader clicks.
 *
 * Ancestor/descendant pairs are skipped. A link inside its own list item
 * overlaps it by definition, and an early version of this check reported
 * those as failures — which buries the two real collisions in a dozen fake
 * ones and is how a noisy test gets ignored.
 *
 * Needs no API: the bar renders from routes and auth state, so it is safe in
 * CI, which starts no backend.
 */
import { expect, test } from '@playwright/test';

/**
 * The band that was broken, its two edges, and the widths above it.
 *
 * 1181 is the first "desktop" width and was the worst case; 1499 and 1500 sit
 * either side of the point where the bar fits unaided. The two mid values are
 * the laptops people actually use.
 */
const WIDTHS = [1181, 1200, 1280, 1366, 1440, 1499, 1500, 1600, 1920];

/** Everything a reader can click in the bar, as flat boxes. */
const CONTROLS =
  '.nav-links a, .nav-links .nav-dropdown-trigger, ' +
  '.nav-utils .util-pill, .nav-utils a, .nav-utils button, .logo';

for (const width of WIDTHS) {
  test(`navigation bar controls do not overlap at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.waitForSelector('.nav-inner');

    const collisions = await page.evaluate((selector) => {
      const visible = [...document.querySelectorAll(selector)].filter((el) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0;
      });

      const hits: string[] = [];
      for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
          const a = visible[i];
          const b = visible[j];
          // A control nested inside another overlaps it by definition.
          if (a.contains(b) || b.contains(a)) continue;

          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
          const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);

          // 1px of tolerance: adjacent boxes can share a subpixel edge at some
          // zoom levels, and failing on that would make this test noise.
          if (overlapX > 1 && overlapY > 1) {
            const name = (el: Element) =>
              (el.textContent || el.className || 'control').trim().slice(0, 20) || 'control';
            hits.push(`"${name(a)}" over "${name(b)}" by ${Math.round(overlapX)}px`);
          }
        }
      }
      return hits;
    }, CONTROLS);

    expect(collisions, `overlapping controls at ${width}px:\n  ${collisions.join('\n  ')}`)
      .toEqual([]);
  });
}
