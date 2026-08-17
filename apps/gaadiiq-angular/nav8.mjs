import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const w of [1440, 1280, 1200, 900]) {
  const p = await b.newPage({ viewport: { width: w, height: 700 } });
  await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(700);
  const r = await p.evaluate(() => {
    const u = document.querySelector('nav ul.nav-links');
    const h = document.querySelector('.hamburger');
    const vis = el => el && getComputedStyle(el).display !== 'none';
    return { row: vis(u), overflow: vis(u) ? u.scrollWidth - u.clientWidth : 0, burger: vis(h) };
  });
  console.log(w, JSON.stringify(r));
  await p.close();
}
await b.close();
