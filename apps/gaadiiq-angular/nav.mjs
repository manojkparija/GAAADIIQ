import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const w of [1600, 1440, 1280]) {
  const p = await b.newPage({ viewport: { width: w, height: 700 } });
  await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(900);
  const m = await p.evaluate(() => {
    const ul = document.querySelector('nav ul');
    const items = [...document.querySelectorAll('nav ul li a')].map(a => a.textContent.trim());
    return { overflow: ul ? ul.scrollWidth - ul.clientWidth : null, count: items.length, hasCarValue: items.includes('Car Value') };
  });
  console.log(w, JSON.stringify(m));
  if (w === 1600) await p.locator('nav').first().screenshot({ path: 'nav.png' });
  await p.close();
}
await b.close();
