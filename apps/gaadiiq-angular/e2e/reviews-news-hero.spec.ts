/**
 * The Reviews & News hero: contrast across its gradient, and its clearance
 * under the navbar.
 *
 * WHY THIS IS NOT PART OF contrast.spec.ts
 *
 * /reviews-news is already in that suite's page list, which makes this hero
 * look covered. It is not. `effectiveBg()` returns null for any element under
 * a `background-image`, and a linear-gradient is one, so every element in here
 * is skipped — deliberately, with the note that one ratio cannot judge text on
 * a colour running blue to teal.
 *
 * That judgement was right about the heading and wrong about everything else.
 * Measured on the hero as it shipped, sampled from the rendered pixels: the
 * subtitle ran 3.12:1 on the blue end down to 2.36:1 on the teal one against
 * the 4.5:1 it needs, the badge 3.10:1, and the gradient "News" word 2.37:1
 * against 3.0. Only "Reviews &" in plain white passed, and nothing reported
 * any of it.
 *
 * A gradient does not have to defeat the measurement — it just cannot be
 * reduced to ONE colour. So this walks the ramp instead: it reads the stops
 * out of the computed background-image, samples along it, and holds the worst
 * point to the WCAG threshold for that text's size. Deliberately scoped to
 * this hero rather than folded into contrast.spec.ts, which would change what
 * every other gradient page in the app reports in the same change.
 *
 * Needs no API. The hero is static markup; the catalogue requests the app
 * fires on load paint none of it.
 */
import { test, expect, Page } from '@playwright/test';

type RGB = [number, number, number];

function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` at its own alpha, painted over an opaque `bg`. */
function over(fg: [number, number, number, number], bg: RGB): RGB {
  return [
    fg[0] * fg[3] + bg[0] * (1 - fg[3]),
    fg[1] * fg[3] + bg[1] * (1 - fg[3]),
    fg[2] * fg[3] + bg[2] * (1 - fg[3]),
  ];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function parseColour(value: string): [number, number, number, number] | null {
  const m = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?/);
  return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
}

/**
 * Every colour stop in a computed `background-image`, in order.
 *
 * getComputedStyle resolves the stops to rgb()/rgba(), so no colour-name or
 * hex handling is needed here — but it also leaves the angle and any
 * percentages in the string, which is why this pulls the colours out rather
 * than parsing the gradient properly. The positions do not matter: what is
 * being asked is "which colours does this element paint", and sampling
 * between consecutive stops covers the ramp between them.
 */
function gradientStops(backgroundImage: string): RGB[] {
  const stops: RGB[] = [];
  for (const m of backgroundImage.matchAll(/rgba?\([^)]*\)/g)) {
    const c = parseColour(m[0]);
    // A fully transparent stop paints nothing and would drag the ramp toward
    // black if treated as a colour.
    if (c && c[3] > 0) stops.push([c[0], c[1], c[2]]);
  }
  return stops;
}

/** Samples along a ramp, so the middle of a gradient is measured too. */
function ramp(stops: RGB[]): RGB[] {
  if (stops.length < 2) return stops;
  const out: RGB[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) out.push(mix(stops[i], stops[i + 1], t));
  }
  return out;
}

async function openHero(page: Page, width: number, theme: 'light' | 'dark') {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: theme });
  // Both signals, as contrast.spec.ts does: the media query covers a viewer on
  // "system", the attribute covers one who has explicitly chosen.
  await page.addInitScript(t => document.documentElement.setAttribute('data-theme', t), theme);
  await page.goto('/reviews-news', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.rn-hero .hero-title');
}

/**
 * The backdrop an element sits on, as a ramp of colours.
 *
 * Walks up from the element: its own opaque or semi-transparent fills are
 * composited over whatever is behind them, and the first gradient found
 * becomes the ramp everything above it is painted over. That is what makes the
 * badge measurable — it is a translucent scrim over the hero's gradient, so it
 * has as many backdrops as the gradient has colours.
 */
async function backdrop(page: Page, selector: string): Promise<{ fills: string[]; gradient: string }> {
  return page.evaluate(sel => {
    const fills: string[] = [];
    let gradient = '';
    for (let n: Element | null = document.querySelector(sel); n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      // A background clipped to the text IS the text — it paints the glyphs,
      // not anything behind them. Treating the gradient word's own fill as its
      // backdrop compared it against itself and reported a flat 1.00:1.
      const clip =
        cs.backgroundClip ||
        (cs as CSSStyleDeclaration & { webkitBackgroundClip?: string }).webkitBackgroundClip;
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && clip !== 'text') {
        gradient = cs.backgroundImage;
        break;
      }
      const bg = cs.backgroundColor;
      if (bg && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(bg)) fills.push(bg);
    }
    return { fills, gradient };
  }, selector);
}

async function inkOf(page: Page, selector: string) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel) as HTMLElement;
    const cs = getComputedStyle(el);
    return {
      color: cs.color,
      // A gradient-filled word paints its own background through the text;
      // `color` on it is transparent and says nothing about what is drawn.
      fill: (cs as CSSStyleDeclaration & { webkitTextFillColor?: string }).webkitTextFillColor ?? '',
      textBackground: cs.backgroundImage,
      px: parseFloat(cs.fontSize),
      weight: parseInt(cs.fontWeight, 10) || 400,
    };
  }, selector);
}

const BANDS = [
  { name: 'the GAADIIQ MEDIA badge', selector: '.rn-hero .hero-badge' },
  { name: 'the plain half of the heading', selector: '.rn-hero .hero-title' },
  { name: 'the gradient word in the heading', selector: '.rn-hero .gradient-text' },
  { name: 'the subtitle', selector: '.rn-hero .hero-sub' },
];

for (const theme of ['light', 'dark'] as const) {
  for (const band of BANDS) {
    test(`${band.name} meets AA across the hero gradient in the ${theme} theme`, async ({ page }) => {
      await openHero(page, 1400, theme);

      const ink = await inkOf(page, band.selector);
      const { fills, gradient } = await backdrop(page, band.selector);
      expect(gradient, `${band.selector} is not over the hero gradient any more`).toContain('gradient');

      // WCAG "large text": >=24px, or >=18.66px when bold. 3.0 rather than 4.5.
      const large = ink.px >= 24 || (ink.px >= 18.66 && ink.weight >= 700);
      const need = large ? 3.0 : 4.5;

      // Every colour the backdrop takes, with the element's own translucent
      // fills (the badge's scrim) painted on top of each.
      const backdrops = ramp(gradientStops(gradient)).map(base => {
        let composed = base;
        for (const fill of [...fills].reverse()) {
          const c = parseColour(fill);
          if (c) composed = over(c, composed);
        }
        return composed;
      });
      expect(backdrops.length).toBeGreaterThan(1);

      // The ink. Normally one colour; for the gradient-filled word it is the
      // ramp of its own background, every point of which is drawn as text.
      const inkStops: RGB[] =
        ink.fill === 'rgba(0, 0, 0, 0)' && ink.textBackground !== 'none'
          ? ramp(gradientStops(ink.textBackground))
          : [];
      const solid = parseColour(ink.fill) ?? parseColour(ink.color);

      let worst = Infinity;
      let worstPair = '';
      for (const bg of backdrops) {
        const inks: RGB[] = inkStops.length
          ? inkStops
          : [over(solid as [number, number, number, number], bg)];
        for (const paint of inks) {
          const got = contrast(paint, bg);
          if (got < worst) {
            worst = got;
            worstPair = `ink rgb(${paint.map(Math.round)}) on rgb(${bg.map(Math.round)})`;
          }
        }
      }

      expect(
        +worst.toFixed(2),
        `${band.name} measures ${worst.toFixed(2)}:1 at its worst point on the gradient ` +
          `(${worstPair}), against the ${need}:1 that ${ink.px}px/${ink.weight} needs`,
      ).toBeGreaterThanOrEqual(need);
    });
  }
}

// Both viewports: --nav-height measures 119px on a desktop and 177px on a
// phone, and the phone breakpoint carries its own padding rule — which is how
// one of the two came to be fixed on its own while the other stayed broken.
for (const width of [1400, 390]) {
  test(`the hero clears the navbar at ${width}px`, async ({ page }) => {
    await openHero(page, width, 'dark');

    const gap = await page.evaluate(() => {
      // The bar's height as the navbar itself republishes it from the rendered
      // element — it compacts on scroll and changes at the breakpoint, so this
      // is the only figure that tracks what is actually drawn.
      const navHeight = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--nav-height'),
      );
      const badge = document.querySelector('.rn-hero .hero-badge') as HTMLElement;
      return badge.getBoundingClientRect().top - navHeight;
    });

    // Not "greater than 0": touching the bar is the bug. `max(7rem,
    // var(--nav-offset))` produced exactly 0 here at both widths, which is why
    // the rule adds 1.5rem on top of the offset.
    expect(
      Math.round(gap),
      `the hero badge sits ${Math.round(gap)}px below the navbar at ${width}px`,
    ).toBeGreaterThanOrEqual(16);
  });
}
