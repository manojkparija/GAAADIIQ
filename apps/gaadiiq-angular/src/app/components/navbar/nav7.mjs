import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const w of [1440, 1366, 1280, 1200, 1150]) {
  const p = await b.newPage({ viewport: { width: w, height: 700 } });
  await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(700);
  const r = await p.evaluate(() => {
    const u = document.querySelector('nav ul.nav-links');
    if (!u || getComputedStyle(u).display === 'none') return { hidden: true };
    return { overflow: u.scrollWidth - u.clientWidth };
  });
  console.log(w, JSON.stringify(r));
  if (w === 1280) await p.locator('nav').first().screenshot({ path: 'nav-flat.png' });
  await p.close();
}
await b.close();
