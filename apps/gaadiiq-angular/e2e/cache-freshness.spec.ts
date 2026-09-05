/**
 * A reader is never served a catalogue old enough to look broken.
 *
 * REPORTED FROM THE LIVE SITE, ALL DAY
 *
 * "why do I need to go for hard refresh on a regular basis" — and later, with
 * screenshots either side of one: a page reading "0 models available" that
 * became "3 models available" the moment it was hard-refreshed. Photographs
 * uploaded against a car did not appear until the same ritual.
 *
 * A hard refresh sends `Cache-Control: no-cache`, which skips the browser
 * cache AND forces the edge to revalidate. That is the only thing it does
 * differently, so the caches were the whole story.
 *
 * TWO CACHES, AND THE ONE THAT ACTUALLY DID IT
 *
 * The API stamped `/cars` with
 * `public, max-age=60, s-maxage=300, stale-while-revalidate=600`. That is up
 * to fifteen minutes of staleness, and the last directive is the deliberate
 * part: stale-while-revalidate serves the expired copy and refreshes behind
 * the reader, so fresh data arrives on the NEXT visit. core/cache_policy.py
 * had already predicted the consequence in its own comment — there is no
 * purge-on-write hook, so the TTL is the only bound on how long an edit stays
 * invisible.
 *
 * The service worker was NOT the cause, though it was blamed for most of the
 * day. Its dataGroup patterns compile to `https://api.gaadiiq.com/cars/.*`,
 * which requires a slash after `cars`; the catalogue is fetched as
 * `/cars?bucket=new&...` and never matched. That was checkable from the
 * generated dist/ngsw.json at any point and was not checked — the source
 * config was read instead, and it describes an intent the build does not
 * deliver.
 *
 * WHAT THESE TESTS HOLD
 *
 * Not "the cache is correct" — that is a judgement about traffic and cost.
 * They hold the two numbers that turned into a page reading zero, in both
 * places, so neither can quietly grow back.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '..', '..', '..');
const NGSW = join(__dirname, '..', 'ngsw-config.json');
const CACHE_POLICY = join(REPO, 'apps', 'api', 'core', 'cache_policy.py');

interface DataGroup {
  name: string;
  urls: string[];
  cacheConfig: { strategy: string; maxAge: string; timeout?: string };
}

function dataGroups(): DataGroup[] {
  return JSON.parse(readFileSync(NGSW, 'utf8')).dataGroups ?? [];
}

/** "10m" / "30s" / "1h" as seconds. */
function seconds(duration: string): number {
  const m = /^(\d+)([smhd])$/.exec(duration.trim());
  if (!m) throw new Error(`unparseable maxAge: ${duration}`);
  return Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2] as 's']!;
}

test('the service worker cannot serve a stale car', () => {
  // This group's patterns do not match the catalogue LIST calls, but they do
  // match /cars/<id> and /cars/<id>/variants. With `freshness` the network is
  // tried first, so the cache is only reached when a request fails or exceeds
  // the timeout — and on a slow connection to the Singapore region a 5s
  // timeout is reachable. It was holding those responses for ten minutes,
  // which is long enough to answer with a car whose photographs had since been
  // uploaded.
  const group = dataGroups().find(g => g.name === 'api-catalogue');
  expect(group, 'the api-catalogue dataGroup is gone — update this test').toBeTruthy();
  expect(
    seconds(group!.cacheConfig.maxAge),
    'a cached car may be served as a fallback for this long; keep it under a minute',
  ).toBeLessThanOrEqual(60);
});

test('no group holding cars or listings outlives a minute', () => {
  // Scoped to the catalogue on purpose, and the scoping is the interesting
  // part. The first version of this test asserted it of EVERY dataGroup and
  // failed on `api-static`, which holds /health and /loans/bank-rates for an
  // hour — correctly. Bank rates change on a timescale of weeks; a stale one
  // is not what put "0 models available" on the page.
  //
  // So the rule is about the data that a person edits and then expects to see:
  // anything under /cars or /listings. A new group covering those inherits the
  // limit automatically, which is the point — the next person adding one does
  // not have to know this history.
  const catalogue = dataGroups().filter(g =>
    g.urls.some(u => /\/(cars|listings)\b/.test(u)),
  );
  expect(catalogue.length, 'no dataGroup covers the catalogue — update this test').toBeGreaterThan(0);

  for (const group of catalogue) {
    expect(
      seconds(group.cacheConfig.maxAge),
      `dataGroup "${group.name}" may serve catalogue data ${group.cacheConfig.maxAge} old`,
    ).toBeLessThanOrEqual(60);
  }
});

test('the API never serves a knowingly stale catalogue', () => {
  // Cross-language on purpose. This number lives in the FastAPI service, but
  // its symptom is entirely a frontend one — a page that reads zero — and
  // nothing on this side of the wire can detect it at runtime. Reading the
  // source is crude and still better than the alternative, which was a whole
  // day of looking in the wrong place.
  const policy = readFileSync(CACHE_POLICY, 'utf8');
  const directive = /^PUBLIC_CACHE_CONTROL\s*=\s*"([^"]+)"/m.exec(policy)?.[1];
  expect(directive, 'PUBLIC_CACHE_CONTROL not found in cache_policy.py').toBeTruthy();

  expect(
    directive,
    'stale-while-revalidate is back: it serves content already known to be out of date',
  ).not.toContain('stale-while-revalidate');

  const edge = Number(/s-maxage=(\d+)/.exec(directive!)?.[1]);
  expect(edge, 's-maxage is the wait between saving a car and seeing it').toBeLessThanOrEqual(60);
});
