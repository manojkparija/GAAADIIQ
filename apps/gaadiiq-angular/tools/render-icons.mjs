/**
 * Regenerate the manifest's `purpose: "any"` PNG icon set.
 *
 *     node tools/render-icons.mjs        (from apps/gaadiiq-angular)
 *
 * WHY THIS EXISTS
 *
 * The manifest declares two icon sets, and they must not be merged:
 *
 *     icon-any-<size>.png   purpose "any"       ← rendered here, from favicon.svg
 *     icon-<size>.png       purpose "maskable"  ← from assets/icons/icon-master.svg
 *
 * They were once a single set declared "maskable any". A maskable icon carries
 * heavy padding and square corners so a launcher can crop it; any surface that
 * does NOT crop — Chrome's "Open in app" chip among them — then shows that raw
 * padded tile. Reported from the live site as the logo looking wrong.
 *
 * Rendered from src/favicon.svg rather than a third copy of the artwork. A mark
 * kept in two places diverges; logo.component.ts documents that at length, and
 * this repo already shipped it once in the chat widget's inlined wordmark.
 *
 * Chromium is the rasterizer because it is what the sandbox and CI already have
 * (PLAYWRIGHT_BROWSERS_PATH), and because rendering through the same engine the
 * browser uses means the PNG cannot disagree with the tab.
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const MASTER = 'src/favicon.svg';
const OUT_DIR = 'src/assets/icons';

/** Every size the manifest declares, so no surface has to scale a mismatch. */
const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

const svg = readFileSync(MASTER, 'utf8');

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: ['--no-sandbox'],
});

for (const size of SIZES) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}` +
    `svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  // omitBackground keeps the rounded corners transparent rather than white —
  // a white corner would show as a light notch on a dark launcher.
  await page.screenshot({
    path: `${OUT_DIR}/icon-any-${size}x${size}.png`,
    omitBackground: true,
  });
  await page.close();
}

await browser.close();
console.log(`rendered ${SIZES.length} icons from ${MASTER}`);
