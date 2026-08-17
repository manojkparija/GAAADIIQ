import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const w of [1440, 1024, 800]) {
  const p = await b.newPage({ viewport: { width: w, height: 700 } });
  await p.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(800);
  const ul = await p.evaluate(() => {
    const u = document.querySelector('nav ul');
    return u ? { overflow: u.scrollWidth - u.clientWidth } : 'hidden';
  });
  // Does Sign In still fit on screen? That is what the scroll container protected.
  const signIn = await p.locator('.nav-actions').boundingBox().catch(() => null);
  console.log(w, JSON.stringify(ul), 'signIn right:', signIn ? Math.round(signIn.x + signIn.width) : 'n/a');
  if (w === 1440) {
    await p.locator('.nav-dd-btn').hover();
    await p.waitForTimeout(400);
    await p.screenshot({ path: 'nav-final.png', clip: { x: 200, y: 0, width: 900, height: 330 } });
  }
  await p.close();
}
await b.close();
