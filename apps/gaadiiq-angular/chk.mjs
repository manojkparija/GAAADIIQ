import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto('http://localhost:4173/used-cars', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.search-select');
const sel = p.locator('.search-select').last();
await sel.focus();
console.log(await sel.evaluate(el => {
  const cs = getComputedStyle(el);
  const opts = [...el.options].map(o => {
    const c = getComputedStyle(o);
    return { text: o.textContent.trim(), bg: c.backgroundColor, color: c.color, sel: o.selected };
  });
  return { focusBorder: cs.borderColor, focusShadow: cs.boxShadow, accent: cs.accentColor, opts: opts.slice(0,3) };
}));
await b.close();
