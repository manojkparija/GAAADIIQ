import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 1700 } });
await p.route('**/valuation/estimate', r => r.fulfill({ status: 503, json: { detail: 'x' } }));
await p.route('**/demand/**', r => r.fulfill({ status: 404, json: {} }));
await p.goto('http://localhost:4173/ai-valuation', { waitUntil: 'networkidle' });
await p.waitForTimeout(900);

// Make, then model (populated by make), then the rest.
const sels = await p.$$('select');
for (const s of sels) {
  const opts = await s.$$eval('option', o => o.map(x => x.value).filter(v => v && v !== ''));
  if (opts.length) { await s.selectOption(opts[0]).catch(()=>{}); await p.waitForTimeout(150); }
}
// re-run so model/variant lists populated by the make selection get a value
for (const s of await p.$$('select')) {
  const val = await s.inputValue();
  if (!val) {
    const opts = await s.$$eval('option', o => o.map(x => x.value).filter(Boolean));
    if (opts.length) await s.selectOption(opts[0]).catch(()=>{});
  }
}
await p.fill('input[type=number]', '29000').catch(()=>{});
await p.waitForTimeout(300);
const btn = p.locator('.val-btn');
console.log('button disabled:', await btn.isDisabled());
await btn.click({ force: true }).catch(e => console.log('click failed'));
await p.waitForTimeout(2000);
const n = await p.locator('.price-range-card').count();
console.log('result card:', n);
if (n) {
  console.log((await p.locator('.price-range-card').innerText()).replace(/\n+/g, ' | '));
  await p.locator('.price-range-card').screenshot({ path: 'val-result.png' });
}
await b.close();
