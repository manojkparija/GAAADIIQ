import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto('http://localhost:4173/used-cars', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.search-select');
await p.evaluate(() => document.querySelectorAll('.search-select')[1].focus());
await p.waitForTimeout(300);
console.log(await p.evaluate(() => {
  const el = document.querySelectorAll('.search-select')[1];
  const cs = getComputedStyle(el);
  return { isFocused: document.activeElement === el, border: cs.borderColor, shadow: cs.boxShadow };
}));
await b.close();
