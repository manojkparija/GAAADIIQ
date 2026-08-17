import { chromium } from '@playwright/test';
const listing = {
  id: 'L-1', listing_type: 'used', price: 282000, km_driven: 29000,
  city: 'Kolkata', image_urls: [], is_featured: false, condition: 'good',
  description: 'Single owner.', ai_valuation: null, owners_count: 1,
  seller: { id: 'S-1', email: 's@example.com', full_name: 'Seller' },
  car: { id: 'C-1', make: 'Maruti Suzuki', model: 'Swift', variant: 'LXi', year: 2018,
         fuel_type: 'petrol', transmission: 'manual', body_type: 'hatchback',
         seating_capacity: 5, engine_cc: 1197, ex_showroom_price: '649000', specs: [], features: [], images: [] },
};
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

// 1. Buyer gauge on a real listing
const p = await b.newPage({ viewport: { width: 1280, height: 1400 } });
await p.route('**/listings?listing_type=used**', r => r.fulfill({ json: { items: [listing], total: 1 } }));
await p.route('**/listings?listing_type=new**', r => r.fulfill({ json: { items: [], total: 0 } }));
await p.route('**/cars?**', r => r.fulfill({ json: { items: [], total: 0 } }));
await p.route('**/demand/**', r => r.fulfill({ status: 404, json: {} }));
await p.goto('http://localhost:4173/cars/L-1', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
console.log('gauge:', await p.locator('.mp-card').count(), '| verdict:', (await p.locator('.mp-verdict').textContent().catch(()=>'-'))?.trim());
console.log('scale:', (await p.locator('.mp-scale').innerText().catch(()=>'-')).replace(/\n/g,' / '));
if (await p.locator('.buyer-checks').count()) await p.locator('.buyer-checks').screenshot({ path: 'gauge.png' });
await p.close();

// 2. Valuation page result
const q = await b.newPage({ viewport: { width: 1280, height: 1600 } });
await q.route('**/valuation/estimate', r => r.fulfill({ status: 503, json: {} }));
await q.route('**/demand/**', r => r.fulfill({ status: 404, json: {} }));
await q.goto('http://localhost:4173/ai-valuation', { waitUntil: 'networkidle' });
await q.waitForTimeout(1200);
console.log('valuation page loaded:', await q.locator('form, .form-card, input, select').count() > 0);
await q.screenshot({ path: 'val-form.png' });
await b.close();
