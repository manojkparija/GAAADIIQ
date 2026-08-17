import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const w of [1440, 1200, 1024, 800]) {
  const p = await b.newPage({ viewport: { width: w, height: 700 } });
  await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => {
    const u = document.querySelector('nav ul.nav-links');
    const h = document.querySelector('.hamburger');
    const vis = el => el && getComputedStyle(el).display !== 'none';
    return { rowShown: vis(u), overflow: vis(u) ? u.scrollWidth - u.clientWidth : 0, burger: vis(h) };
  });
  console.log(w, JSON.stringify(r));
  await p.close();
}
const p = await b.newPage({ viewport: { width: 1440, height: 700 } });
await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
await p.locator('.nav-dd-btn').hover();
await p.waitForTimeout(400);
await p.screenshot({ path: 'navfinal.png', clip: { x: 250, y: 0, width: 800, height: 330 } });
await b.close();
