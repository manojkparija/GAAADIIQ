/**
 * Every column the list-car form inserts must be one we can show exists.
 *
 * Reported from production: submitting a listing failed with
 *   PGRST204: Could not find the 'description' column of 'cars' in the schema cache
 *
 * list-car.component.ts writes a flattened advert straight into public.cars via
 * Supabase, naming ~23 columns and bypassing both the API and the ORM. Nothing
 * checked that list against the live table. A column the table lacks rejects
 * the whole row — every time, identically — and PostgREST names only the FIRST
 * column it cannot find, so fixing them one at a time costs one failed
 * submission per deploy.
 *
 * This is a *static* check: it reads source, starts no browser and needs no
 * API. It cannot see the live database (nothing in CI can), so it does not
 * claim the columns exist in Supabase. What it claims is narrower: every
 * inserted column is added by a migration in supabase/migrations. A column
 * named by the insert and by no migration is the exact shape of this bug.
 *
 * AN EARLIER VERSION OF THIS FILE CERTIFIED A BROKEN FIX.
 *
 * It also counted a column as accounted for if my-listings.service.ts selected
 * it, reasoning that the screen works so those columns must exist. The select's
 * result is discarded unless it succeeds — `if (!error && data && data.length)`,
 * wrapped in a catch that keeps local data, behind a 5s timeout that resolves
 * to an error object. A select that fails on a missing column takes the same
 * path as one returning nothing: the screen falls back to localStorage and
 * looks entirely normal. `image_url` was in that select and did not exist.
 *
 * A screen that cannot tell success from failure is evidence of neither, so
 * migrations are now the only thing counted.
 *
 * It lives in e2e/ because Karma specs run in a browser and have no `fs`.
 * It is added to desktop-chrome's testMatch, so CI runs it.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const APP = join(__dirname, '..');
const REPO = join(APP, '..', '..');

const LIST_CAR = join(APP, 'src/app/pages/list-car/list-car.component.ts');
const SUPABASE_MIGRATIONS = join(REPO, 'supabase/migrations');

/** The column names in the `.from('cars').insert({...})` object literal. */
function insertedColumns(): string[] {
  const src = readFileSync(LIST_CAR, 'utf8');
  const at = src.indexOf(".from('cars')");
  expect(at, 'the cars insert moved — this guard is now checking nothing').toBeGreaterThan(-1);

  // From the insert's opening brace to its closing one, by brace depth rather
  // than by a regex: the object spans ~30 lines and contains nested braces in
  // template literals and ternaries.
  const open = src.indexOf('{', src.indexOf('.insert(', at));
  let depth = 0;
  let end = open;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i; break; }
  }
  const body = src.slice(open + 1, end);

  // Keys at depth 0 of the literal only, so a key inside a nested object is
  // not mistaken for a column.
  const cols: string[] = [];
  depth = 0;
  for (const line of body.split('\n')) {
    const stripped = line.replace(/\/\/.*$/, '');
    if (depth === 0) {
      const m = stripped.match(/^\s*([a-z_][a-z0-9_]*)\s*:/i);
      if (m) cols.push(m[1]);
    }
    for (const ch of stripped) {
      if (ch === '{' || ch === '[' || ch === '(') depth++;
      else if (ch === '}' || ch === ']' || ch === ')') depth--;
    }
  }
  return cols;
}

/** Columns any hand-run Supabase migration adds to cars. */
function addedByMigrations(): string[] {
  const cols: string[] = [];
  for (const f of readdirSync(SUPABASE_MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(SUPABASE_MIGRATIONS, f), 'utf8');
    // Only ALTERs aimed at cars; a column added to sellers proves nothing here.
    for (const block of sql.split(/ALTER\s+TABLE\s+/i).slice(1)) {
      if (!/^(public\.)?cars\b/i.test(block.trim())) continue;
      for (const m of block.matchAll(/ADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
        cols.push(m[2]);
      }
    }
  }
  return cols;
}

test.describe('the list-car insert against public.cars', () => {
  test('names no column this repository cannot account for', () => {
    const inserted = insertedColumns();

    // If the parse breaks, everything below passes vacuously. Assert it found
    // a realistic column list before trusting any conclusion drawn from it.
    expect(inserted.length, 'parsed no columns — the guard would pass vacuously')
      .toBeGreaterThan(15);
    expect(inserted).toContain('make');
    expect(inserted).toContain('description');

    const accounted = new Set(addedByMigrations());
    const unaccounted = inserted.filter((c) => !accounted.has(c));

    expect(
      unaccounted,
      `These columns are inserted into public.cars but no migration adds ` +
      `them. That is how PGRST204 reached production. Add them in a ` +
      `supabase/migrations file, or stop inserting them: ` +
      `${unaccounted.join(', ')}`,
    ).toEqual([]);
  });

  test('the migration that fixed this is still present', () => {
    // Named directly: the column the production error reported. A later edit
    // that drops it from 014 would put the original bug back, and the check
    // above would still pass if it were dropped from the insert too.
    expect(addedByMigrations()).toContain('description');
  });
});
