import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const w of [1920, 1750, 1600, 1500, 1440, 1366]) {
  const p = await b.newPage({ viewport: { width: w, height: 700 } });
  await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(600);
  const r = await p.evaluate(() => {
    const u = document.querySelector('nav ul.nav-links');
    if (!u || getComputedStyle(u).display === 'none') return 'hidden';
    return u.scrollWidth - u.clientWidth;
  });
  console.log(w, 'overflow:', r);
  await p.close();
}
await b.close();
