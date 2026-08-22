#!/usr/bin/env node
/**
 * How much English is still visible with the site set to Hindi?
 *
 * WHY THIS EXISTS
 * Translation was done page by page against a hand-written phrase list per
 * page, and every page reported "done" when its own list was applied. That
 * measure was wrong in three ways at once, and none of them were visible from
 * the code:
 *
 *   - a string already in the dictionary stayed English if the page's own list
 *     did not happen to repeat it (the Transmission label on /ai-valuation);
 *   - placeholder="..." is user-visible but is not a text node, so the
 *     text-node walker never saw any of the 124 placeholders in the app;
 *   - child components (pricing-strategy, custom-select, car-card, …) were
 *     never visited at all, only page templates were.
 *
 * The only honest way to answer "is this page in Hindi" is to render it in
 * Hindi and read what is on the screen. That is what this does: it walks the
 * rendered DOM of every public route and reports each visible text node that
 * contains Latin letters and no Devanagari.
 *
 * USAGE
 *   npx ng build
 *   npx http-server dist/gaadiiq-angular/browser -p 4351 --proxy "http://localhost:4351?"
 *   node scripts/hindi-coverage.js [--list]
 *
 * EXPECTED NOISE
 * Brand and model names (GAADIIQ, Swift, Nexon), and market terms deliberately
 * kept in Latin script because that is how they are said in Hindi (EMI, SUV,
 * CNG, km). Those are counted but are not defects — use --list to see them.
 */
const { chromium } = require('playwright');

const PORT = process.env.PORT || 4351;
const ROUTES = [
  '/', '/new-cars', '/used-cars', '/compare', '/ai-advisor', '/ai-valuation',
  '/vehicle-diagnosis', '/emi-calculator', '/car-loan', '/tco', '/ev-calculator',
  '/reviews-news', '/buyer-journey', '/find-mechanic', '/test-drive',
  '/pricing-plans', '/about', '/login', '/register',
];

(async () => {
  const list = process.argv.includes('--list');
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN || undefined,
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem('gaadiiq_lang', 'hi'));

  let total = 0;
  for (const route of ROUTES) {
    await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    const left = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('body *').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        el.childNodes.forEach(n => {
          if (n.nodeType !== 3) return;
          const t = n.textContent.trim();
          if (t.length < 3 || /[ऀ-ॿ]/.test(t) || !/[A-Za-z]{3}/.test(t)) return;
          out.push(t.slice(0, 70));
        });
      });
      return [...new Set(out)];
    });
    total += left.length;
    console.log(route.padEnd(20), String(left.length).padStart(3));
    if (list) left.forEach(s => console.log('     ', s));
  }
  console.log('\nTotal English strings visible in Hindi mode:', total);
  await browser.close();
})();
