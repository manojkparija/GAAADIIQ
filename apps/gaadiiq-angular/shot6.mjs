import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 1700 } });
await p.route('**/valuation/estimate', r => r.fulfill({ status: 503, json: {} }));
await p.route('**/demand/**', r => r.fulfill({ status: 404, json: {} }));
await p.goto('http://localhost:4173/ai-valuation', { waitUntil: 'networkidle' });
await p.waitForTimeout(900);
for (const s of await p.$$('select')) {
  const o = await s.$$eval('option', x => x.map(v => v.value).filter(Boolean));
  if (o.length) { await s.selectOption(o[0]).catch(()=>{}); await p.waitForTimeout(120); }
}
for (const s of await p.$$('select')) {
  if (!(await s.inputValue())) {
    const o = await s.$$eval('option', x => x.map(v => v.value).filter(Boolean));
    if (o.length) await s.selectOption(o[0]).catch(()=>{});
  }
}
await p.fill('input[type=number]', '29000').catch(()=>{});
await p.locator('.val-btn').click({ force: true });
await p.waitForTimeout(1800);
console.log((await p.locator('.price-range-card').innerText()).replace(/\n+/g, ' | ').slice(0, 400));
await p.locator('.price-range-card').screenshot({ path: 'val2.png' });
await b.close();
