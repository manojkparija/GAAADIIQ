/**
 * The API base is written down in three places, and they have to agree.
 *
 * `environment.prod.ts` says where the app sends requests. `vercel.json`'s
 * Content-Security-Policy says which origins the browser is permitted to reach.
 * `ngsw-config.json` says which responses the service worker may cache. Miss
 * the CSP and every call is blocked by the browser with nothing on screen —
 * errors appear only in the console, the same shape of failure as the JWKS bug:
 * the app looks fine and silently does nothing.
 *
 * That third file has already been wrong once. Its rules named `/api/...` on the
 * app's own origin while the API was on another host entirely, so they matched
 * nothing and the client-side cache people believed in did not exist.
 *
 * Both hostnames are permitted on purpose. api.gaadiiq.com is a proxied CNAME to
 * gaadiiq-api.onrender.com, so grey-clouding that record in Cloudflare is the
 * rollback: traffic stops passing through the proxy without a code change or an
 * APK rebuild. Allowing only one would turn that one-minute lever into a release.
 *
 * A source-only check, like theme-tokens and listing-columns: no browser, no API.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const ROOT = join(__dirname, '..');
const DOMAIN = 'https://api.gaadiiq.com';
const ORIGIN = 'https://gaadiiq-api.onrender.com';

const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const ngsw = JSON.parse(readFileSync(join(ROOT, 'ngsw-config.json'), 'utf8'));
const envSource = readFileSync(join(ROOT, 'src/environments/environment.prod.ts'), 'utf8');

/** apiUrl as written, ignoring the comment block above it. */
function apiUrl(): string {
  const m = envSource.match(/^\s*apiUrl:\s*'([^']+)'/m);
  expect(m, 'apiUrl not found in environment.prod.ts').not.toBeNull();
  return m![1];
}

function connectSrc(): string {
  const headers = vercel.headers[0].headers as { key: string; value: string }[];
  const csp = headers.find(h => h.key === 'Content-Security-Policy')!.value;
  return csp.split(';').map(s => s.trim()).find(s => s.startsWith('connect-src'))!;
}

const cacheUrls = (): string[] => ngsw.dataGroups.flatMap((g: any) => g.urls);

test('the app calls the domain, not the Render origin directly', () => {
  expect(apiUrl()).toBe(DOMAIN);
});

test('the CSP permits the origin the app calls', () => {
  // Without this the browser blocks every call and shows nothing on screen.
  expect(connectSrc()).toContain(DOMAIN);
});

test('the CSP still permits the Render origin, so the DNS rollback works', () => {
  expect(connectSrc()).toContain(ORIGIN);
});

test('the service worker caches under both hostnames', () => {
  const urls = cacheUrls();
  expect(urls.some(u => u.startsWith(DOMAIN)), 'domain').toBeTruthy();
  expect(urls.some(u => u.startsWith(ORIGIN)), 'origin').toBeTruthy();
});

test('no cache rule is written as a bare path', () => {
  // The original bug: /api/listings/** against an API on another host with no
  // /api prefix. A path-only pattern is almost certainly that mistake again.
  expect(cacheUrls().filter(u => !u.startsWith('https://'))).toEqual([]);
});

test('every cache rule names one of the two known hosts', () => {
  const hosts = [...new Set(cacheUrls().map(u => new URL(u.replace(/\*/g, 'x')).origin))];
  expect(hosts.sort()).toEqual([DOMAIN, ORIGIN].sort());
});
