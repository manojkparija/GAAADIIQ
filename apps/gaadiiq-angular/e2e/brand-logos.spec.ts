/**
 * Brand logos are served from this repo and every one of them exists.
 *
 * REPORTED FROM THE LIVE SITE
 *
 * The /new-cars brand grid rendered as a wall of dark navy tiles reading
 * "No Image Available" — every brand except Mahindra and VinFast.
 *
 * Those tiles were not broken images. They were `assets/cars/placeholder.svg`,
 * swapped in by `new-cars.component.ts::onImgError` when the real logo failed
 * to load. Migration 003 had pointed 35 brands at
 * `cdn.jsdelivr.net/gh/filippofilip95/car-logos-dataset@latest/...`; Mahindra
 * was moved back to a local SVG by 004, and VinFast was never in 003. The two
 * brands that rendered were exactly the two not fed by the CDN.
 *
 * WHY A SOURCE CHECK, AND WHAT IT CAN AND CANNOT HOLD
 *
 * Nothing failed at build time. The data was valid, the component behaved
 * correctly, and the fallback did its job — the grid degraded silently and
 * looked like a styling bug. There is no error anywhere to assert on.
 *
 * What a test CAN hold is the two invariants that would have caught it:
 * no logo is fetched from someone else's host, and every logo names a file
 * that is actually in this repository.
 *
 * What it CANNOT hold is the live `brands` table, which is what the app
 * really reads — `brands.service` prefers `logo_url` from Supabase and only
 * falls back to this list when that table has no rows. The database is fixed
 * by 021_brand_logos_off_the_cdn.sql, run by hand. So a green run here does
 * NOT prove the deployed grid is correct; it proves this repo will not
 * reintroduce the problem.
 *
 * Runs in the desktop-chrome project, which is what CI executes. It reads
 * files and starts no browser, like listing-columns, theme-tokens and
 * pwa-icons — and it is named in that project's `testMatch`, without which it
 * would run nowhere and report nothing.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'src');
const BRANDS_TS = join(SRC, 'app', 'data', 'brands.ts');

/** Every `logo:` value in the BRANDS list, as written. */
function logoPaths(): string[] {
  const source = readFileSync(BRANDS_TS, 'utf8');
  return [...source.matchAll(/logo:\s*['"`]([^'"`]+)['"`]/g)].map(m => m[1]);
}

test('the brand list is not empty', () => {
  // Guards every other test here: a regex that silently matched nothing would
  // make all of them pass over an empty array.
  expect(logoPaths().length).toBeGreaterThan(30);
});

test('no brand logo is fetched from a third-party host', () => {
  // The specific failure was jsDelivr, but the defect is the dependency, not
  // the vendor: `@latest` is not a pin, and nothing about that repository's
  // tags, layout or availability is ours to control. When it changes, the
  // grid fills with placeholders and nothing errors.
  const remote = logoPaths().filter(p => /^https?:\/\//i.test(p));
  expect(remote, 'a brand logo points at an external URL — it will fail silently')
    .toEqual([]);
});

test('every brand logo names a file that exists in this repo', () => {
  // A logo_url pointing at a missing file renders the exact same "No Image
  // Available" tile as an unreachable CDN. Moving the paths local only helps
  // if the files are really there.
  const missing = logoPaths().filter(p => !existsSync(join(SRC, p)));
  expect(missing, 'brand logo files named but not present').toEqual([]);
});

test('the placeholder is still what a failed logo falls back to', () => {
  // Not a complaint about the fallback — it did its job. This pins the thing
  // that made the bug legible: the tiles on screen were this file, and
  // recognising it is what identified the cause. If it is renamed, the next
  // person loses that thread.
  //
  // Note it is the CAR placeholder (400x220, "No Image Available"), reused for
  // a brand tile by onImgError. Correct enough to be recognisable, and left
  // alone here — swapping it is a design decision, not part of this fix.
  const placeholder = join(SRC, 'assets', 'cars', 'placeholder.svg');
  expect(existsSync(placeholder), 'assets/cars/placeholder.svg is gone').toBe(true);
  expect(readFileSync(placeholder, 'utf8')).toContain('No Image Available');
});
