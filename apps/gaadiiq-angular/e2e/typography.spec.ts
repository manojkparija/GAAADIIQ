/**
 * Typography audit: font family, size and alignment, measured on the rendered
 * page across every public route.
 *
 * WHY THIS IS MEASURED AND NOT READ
 *
 * The stylesheet says what an author intended. The browser says what a reader
 * gets, and the two part company constantly — a rule loses to a more specific
 * one, a component's own styles win over the page's, a font silently falls
 * back to the system stack because the family name was misspelt. Every gap
 * this file has found so far was invisible in the SCSS and obvious in
 * getComputedStyle.
 *
 * THE SPEC BEING TESTED
 *
 * From styles.scss: 'Outfit' for headings, 'Manrope' for body. Those are the
 * two families the design system declares, so a third family is a defect
 * whatever it looks like. Sizes and alignment are checked against legibility
 * floors rather than a fixed scale, because the app deliberately uses fluid
 * clamp() sizing and a fixed scale would report every responsive heading.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not assert an exact px size for any element. That would freeze the
 * fluid type scale and fail on the next viewport change without anything
 * being wrong. It reports what a reader cannot read or what is inconsistent
 * with its own neighbours — defects, not deviations from my taste.
 */
import { test, expect, type Page } from '@playwright/test';

// Routes reachable without a login. Guarded pages (admin/*, dealer-dashboard,
// profile) redirect anonymously, so auditing them here would audit the login
// page five times and report it as clean.
const PUBLIC_ROUTES = [
  '/', '/listings', '/new-cars', '/used-cars', '/compare',
  '/emi-calculator', '/car-loan', '/tco', '/ev-calculator',
  '/ai-advisor', '/ai-valuation', '/vehicle-diagnosis',
  '/test-drive', '/list-car', '/find-mechanic', '/mechanic-signup',
  '/reviews-news', '/video-review', '/ev-charging', '/pricing-plans', '/about', '/brand-logos',
  '/buyer-journey', '/login', '/register',
  '/privacy-policy', '/terms-of-service', '/cookie-policy',
];

// The two families styles.scss declares. Anything else means a rule missed
// its target or a family name did not resolve and the browser fell back.
const ALLOWED_FAMILIES = ['Outfit', 'Manrope'];

// The floor for meta text — badges, chips, captions. Set at 11px rather than
// 12px on purpose: the app has a deliberate, consistent 0.72rem (11.5px) meta
// scale used across dozens of components, and failing all of it would be
// reporting a design decision as a defect. 11px catches what is genuinely
// too small without conscripting the whole scale.
const MIN_BODY_PX = 11;

// One known exception, measured and recorded rather than waived silently:
// the lender tile shrinks to 9.9px so KOTAK stays on one line inside a 36px
// box. Raising it needs a wider tile, which moves the row layout — a design
// change, not a defect fix. See lender-mark.component.scss.
const SIZE_EXEMPT = ['lm-mark'];

// A heading rendering at body size usually means its rule lost to something
// more specific. Uppercase letter-spaced labels are excluded: an <h4> styled
// as a small-caps eyebrow is a real idiom, used by the footer on every page,
// and is not the failure this is looking for.
const MIN_HEADING_PX = 15;

interface TypeSample {
  route: string;
  tag: string;
  cls: string;
  text: string;
  family: string;
  px: number;
  align: string;
  weight: string;
  overflowing: boolean;
  /** Uppercase + letter-spaced: the eyebrow-label idiom, not a shrunken heading. */
  isLabelStyle: boolean;
  /** Hidden-but-readable text, which is clipped on purpose. */
  srOnly: boolean;
}

/** Everything a reader actually sees, with the styles the browser resolved. */
async function sampleText(page: Page, route: string): Promise<TypeSample[]> {
  return page.evaluate((r) => {
    const out: TypeSample[] = [];
    const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'CODE', 'PRE']);

    for (const el of Array.from(document.querySelectorAll('*'))) {
      const he = el as HTMLElement;
      if (SKIP.has(he.tagName)) continue;
      if (he.closest('svg, code, pre')) continue;

      // Only elements holding their own text. A wrapper inherits its child's
      // computed family and would report the same defect many times over.
      const own = Array.from(he.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;

      const box = he.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;

      const cs = getComputedStyle(he);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;

      // Text wider than the box it sits in, with no way to scroll to it: the
      // reader loses the end of the sentence. clientWidth excludes the
      // scrollbar, so a genuinely scrollable box is not reported.
      const clipped =
        he.scrollWidth > he.clientWidth + 1 &&
        cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' &&
        cs.textOverflow !== 'ellipsis';

      out.push({
        route: r,
        tag: he.tagName,
        cls: (typeof he.className === 'string' ? he.className : '').slice(0, 60),
        text: own.slice(0, 45),
        family: (cs.fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim(),
        px: Math.round(parseFloat(cs.fontSize)),
        align: cs.textAlign,
        weight: cs.fontWeight,
        overflowing: clipped,
        isLabelStyle:
          cs.textTransform === 'uppercase' &&
          cs.letterSpacing !== 'normal' &&
          parseFloat(cs.letterSpacing) > 0,
        srOnly: /sr-only|visually-hidden/.test(
          typeof he.className === 'string' ? he.className : '',
        ),
      });
    }
    return out;
  }, route);
}

async function visit(page: Page, route: string) {
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  // Webfonts resolve after first paint; sampling before they land reports the
  // fallback family for every element on the page.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

test.describe('typography', () => {
  // Each route is measured independently — nothing here shares state — and run
  // serially the 26 of them took 5.8 minutes, which is most of the web CI job
  // on its own. Parallel is safe and roughly quarters that.
  test.describe.configure({ mode: 'parallel' });

  for (const route of PUBLIC_ROUTES) {
    test(`${route} uses the declared type system`, async ({ page }) => {
      await visit(page, route);
      const samples = await sampleText(page, route);

      // A route that rendered nothing must fail loudly. Zero samples and zero
      // problems are indistinguishable in a pass/fail count, and I have
      // already once reported a sweep "clean" that had measured an empty page.
      expect(samples.length, `${route} rendered no text at all`).toBeGreaterThan(5);

      const foreign = samples.filter(s => !ALLOWED_FAMILIES.includes(s.family));

      const tiny = samples.filter(
        s => s.px < MIN_BODY_PX && !SIZE_EXEMPT.some(c => s.cls.includes(c)),
      );

      // An uppercase, letter-spaced heading is an eyebrow label, not a heading
      // that lost its size.
      const smallHeads = samples.filter(
        s => /^H[1-6]$/.test(s.tag) && s.px < MIN_HEADING_PX && !s.isLabelStyle,
      );

      // sr-only text is clipped deliberately — that is how it is hidden from
      // sight while staying available to a screen reader. Reporting it would
      // be reporting the technique working.
      const clipped = samples.filter(s => s.overflowing && !s.srOnly);

      const report = (label: string, rows: TypeSample[]) =>
        rows.length
          ? `\n${label} (${rows.length}):\n` +
            rows.slice(0, 12)
              .map(s => `  <${s.tag} class="${s.cls}"> ${s.px}px ${s.family} "${s.text}"`)
              .join('\n')
          : '';

      const problems =
        report('FOREIGN FONT FAMILY', foreign) +
        report(`BELOW ${MIN_BODY_PX}px`, tiny) +
        report(`HEADING BELOW ${MIN_HEADING_PX}px`, smallHeads) +
        report('TEXT CLIPPED BY ITS CONTAINER', clipped);

      expect(problems, `${route}${problems}`).toBe('');
    });
  }
});
