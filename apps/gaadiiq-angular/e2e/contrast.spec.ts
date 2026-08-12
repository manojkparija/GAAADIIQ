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
 * LIGHT THEME ONLY, deliberately.
 *
 * Dark mode currently has around twenty failures of the same kind, all from
 * hardcoded hexes that predate the theme tokens (#2563EB and #1E40AF in
 * particular, plus --text-tertiary at rgba(255,255,255,0.38) on tinted
 * panels). They are real and worth fixing, but they are not this change, and a
 * test that starts red is a test people learn to ignore. Add `dark` to THEMES
 * once those are cleared.
 */

const PAGES = ['/', '/new-cars', '/used-cars', '/compare', '/emi-calculator', '/reviews-news', '/car-loan'];

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

for (const path of PAGES) {
  test(`text on ${path} meets WCAG AA in the light theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    // The pages fetch a catalogue on load; give the real content time to land,
    // since a skeleton has different colours from the thing it stands in for.
    await page.waitForTimeout(2500);

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

    expect(distinct.size, `Text below WCAG AA on ${path}:\n${report}\n`).toBe(0);
  });
}
