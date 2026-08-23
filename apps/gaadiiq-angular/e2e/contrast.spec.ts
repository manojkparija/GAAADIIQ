import { test, expect, Page } from '@playwright/test';

/**
 * Text contrast, measured on the rendered page.
 *
 * A contrast checker fed two hex values answers a different question from the
 * one that matters. Text lands on whatever its ancestors actually painted, and
 * in this app that is usually a tint of its own hue over the page background,
 * not the white a swatch assumes. --primary measured 4.50:1 on a white card —
 * a pass — while the same blue in an 11px badge measured 4.27:1 on the tint it
 * actually sits on, which is a fail nobody would find by eye.
 *
 * BOTH THEMES.
 *
 * Dark mode used to be excluded with a note saying it had "around twenty"
 * failures. Measured, it had 23 distinct ones across these seven pages, from
 * three causes:
 *
 *   - hardcoded blues (#2563EB, #1E40AF) predating the tokens, the worst at
 *     1.58:1;
 *   - --text-tertiary at rgba(255,255,255,0.38), 3.3-3.5:1 on tinted panels;
 *   - and a subtler one worth naming: var(--primary) used as text on surfaces
 *     that stay white in *both* themes. --primary brightens to #5B8FFF for
 *     dark backgrounds, so on a white pill it fell to 3.08:1. A token that
 *     flips, on a surface that does not. --ink-on-white exists for that case.
 *
 * All cleared, so dark is measured here too and stays measured.
 */

const PAGES = ['/', '/new-cars', '/used-cars', '/compare', '/emi-calculator', '/reviews-news', '/car-loan', '/insurance', '/video-review'];

interface Failure {
  text: string;
  got: number;
  need: number;
  px: number;
  weight: number;
  color: string;
  bg: string;
  sel: string;
}

async function findLowContrastText(page: Page): Promise<Failure[]> {
  return page.evaluate(() => {
    const parse = (c: string) => {
      const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
      return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
    };
    type C = { r: number; g: number; b: number; a: number };
    const over = (fg: C, bg: C): C => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });
    const lum = (c: C) => {
      const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a: C, b: C) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };

    // Composited bottom-up. Folding downward treats the first semi-transparent
    // ancestor as an opaque backdrop, so a 3.5% dark tint over a light page
    // resolves to near-black and every label inside it looks invisible.
    //
    // Returns null when the background cannot be reduced to a single colour —
    // a gradient or image. Those are design calls one ratio cannot judge:
    // white on a blue-to-teal gradient passes at one end and not the other.
    const effectiveBg = (el: Element): C | null => {
      const layers: C[] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
        const c = parse(cs.backgroundColor);
        if (!c || c.a === 0) continue;
        layers.push(c);
        if (c.a === 1) break;
      }
      let base: C = { r: 255, g: 255, b: 255, a: 1 };
      if (layers.length && layers[layers.length - 1].a === 1) base = layers.pop()!;
      for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
      return base;
    };

    const hex = (c: C) => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    const out: Failure[] = [];

    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const text = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => (n.textContent ?? '').trim())
        .join(' ')
        .trim();
      if (!text || text.length < 2) continue;

      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;

      const fg = parse(cs.color);
      if (!fg || fg.a === 0) continue;
      const bg = effectiveBg(el);
      if (!bg) continue;

      const px = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      // WCAG "large text": >=24px, or >=18.66px when bold.
      const large = px >= 24 || (px >= 18.66 && weight >= 700);
      const need = large ? 3.0 : 4.5;
      const got = ratio(fg.a < 1 ? over(fg, bg) : fg, bg);
      if (got < need) {
        out.push({
          text: text.slice(0, 40),
          got: +got.toFixed(2),
          need,
          px: +px.toFixed(1),
          weight,
          color: cs.color,
          bg: hex(bg),
          sel: el.tagName.toLowerCase() +
            (typeof el.className === 'string' && el.className.trim()
              ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
              : ''),
        });
      }
    }
    return out;
  }) as Promise<Failure[]>;
}

const THEMES = ['light', 'dark'] as const;

for (const theme of THEMES)
for (const path of PAGES) {
  test(`text on ${path} meets WCAG AA in the ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    // Both signals: the media query covers a viewer on "system", the attribute
    // covers one who has explicitly chosen. They are set independently in
    // styles.scss and a rule can be right under one and wrong under the other.
    await page.addInitScript(t => {
      document.documentElement.setAttribute('data-theme', t);
    }, theme);
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    // The pages fetch a catalogue on load; give the real content time to land,
    // since a skeleton has different colours from the thing it stands in for.
    await page.waitForTimeout(2500);

    // A page that rendered nothing has no low-contrast text on it and passes
    // every assertion below. That is not a hypothetical: a static server left
    // pointing at the wrong directory served 404s for every bundle, and this
    // whole suite reported green against blank pages while the run that
    // actually looked for an element failed. "No failures found" and "nothing
    // was measured" must not look the same, so assert the page has content
    // before drawing any conclusion from its absence of faults.
    const visibleText = await page.evaluate(
      () => (document.body.innerText || '').trim().length
    );
    expect(
      visibleText,
      `${path} (${theme}) rendered no text — the contrast result below would be vacuous`
    ).toBeGreaterThan(200);

    const failures = await findLowContrastText(page);

    // One bad rule repeated across twenty cards is one problem, not twenty.
    const distinct = new Map<string, Failure & { count: number }>();
    for (const f of failures) {
      const key = `${f.sel}|${f.color}|${f.bg}`;
      const seen = distinct.get(key);
      if (seen) seen.count++;
      else distinct.set(key, { ...f, count: 1 });
    }

    const report = [...distinct.values()]
      .sort((a, b) => a.got - b.got)
      .map(f => `  ${f.got}:1 (needs ${f.need})  ${f.px}px/${f.weight}  ${f.sel}  ` +
                `fg=${f.color} bg=${f.bg}  x${f.count}  "${f.text}"`)
      .join('\n');

    expect(distinct.size, `Text below WCAG AA on ${path} (${theme}):\n${report}\n`).toBe(0);
  });
}

/**
 * The navbar's own fill must be opaque.
 *
 * This is a separate test from the ones above because the contrast walk could
 * not have caught what it is guarding against, and it is worth being precise
 * about why. To find the background a run of text actually sits on, the walk
 * climbs the ancestor chain until it meets a non-transparent fill. For text in
 * the navbar that chain is .navbar -> body, so when .navbar had no fill at all
 * the walk resolved to body's --navy and measured the link against a colour
 * the reader never saw. It reported a comfortable pass while the bar on screen
 * was a saturated blue-teal with dark text on it.
 *
 * The bar is `position: fixed`. What is painted behind it is whatever is
 * scrolled under it at that instant, which is not an ancestor, differs per
 * route, and changes as the page moves. No walk over the DOM can resolve it.
 *
 * So the invariant is not "the navbar's contrast is good" — it is "the navbar
 * is not transparent", which makes the contrast measurable at all. The
 * original defect was a color-mix over `--bg`, a token this app never defines;
 * an invalid argument invalidates the whole declaration silently, so nothing
 * failed and nothing warned.
 */
for (const theme of THEMES)
for (const path of ['/', '/compare', '/new-cars']) {
  test(`navbar is opaque on ${path} in the ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(t => {
      document.documentElement.setAttribute('data-theme', t);
    }, theme);
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    // Wait for the bar itself rather than a fixed delay. This was
    // waitForTimeout(1500) and began failing the moment the bundle grew:
    // querySelector('.navbar') returned null and the error surfaced as
    // "getComputedStyle: parameter 1 is not of type 'Element'", which reads
    // like a broken test rather than a slow boot. A timeout tuned to today's
    // bundle is a test that expires.
    await page.waitForSelector('.navbar', { state: 'attached' });

    const alphaOf = (css: string): number => {
      if (css === 'transparent') return 0;
      const parts = css.match(/[\d.]+/g);
      if (!parts) return 1;
      return parts.length >= 4 ? Number(parts[3]) : 1;
    };

    const barBg = await page.evaluate(
      () => getComputedStyle(document.querySelector('.navbar')!).backgroundColor
    );
    expect(alphaOf(barBg), `.navbar background on ${path} (${theme}) is ${barBg}`).toBe(1);

    // The dropdown panels have the same requirement and failed it for the same
    // kind of reason: --surface resolves to rgba(255,255,255,0.04) in dark
    // mode, so the mega-menu was a 4%-white pane you could read the page
    // through.
    const trigger = page.locator('.nav-dropdown-trigger').first();
    if (await trigger.count()) {
      await trigger.click();
      const panel = page.locator('.nav-mega').first();
      if (await panel.count()) {
        const panelBg = await panel.evaluate(el => getComputedStyle(el).backgroundColor);
        expect(
          alphaOf(panelBg),
          `.nav-mega background on ${path} (${theme}) is ${panelBg}`
        ).toBe(1);
      }
    }
  });
}
