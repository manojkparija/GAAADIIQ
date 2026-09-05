/**
 * The manifest declares an unmasked icon, not only a maskable one.
 *
 * REPORTED FROM THE LIVE SITE, TWICE
 *
 * Chrome's "Open in app" chip showed a hard-edged blue square with the mark
 * floating small in the middle, next to a browser tab showing the properly
 * filled favicon. It read as the wrong logo, and it was — of a sort.
 *
 * Every icon was declared `purpose: "maskable any"`. A maskable icon is drawn
 * for a launcher that CROPS it: full-bleed square, no corner radius, and the
 * mark shrunk inside an 80%-diameter safe circle so nothing important is cut.
 * `icon-master.svg` says exactly that in its own comment. Android crops it and
 * the padding vanishes. Chrome's chip does not crop, so it showed the raw
 * padded tile — correct file, wrong shape for the surface.
 *
 * `"maskable any"` means "use me for both", so with no plain `"any"` entry
 * there was nothing better for Chrome to choose.
 *
 * WHY THIS IS A SOURCE CHECK
 *
 * There is nothing to fail at build time: the manifest was valid JSON with
 * valid icons, and every file it named existed and rendered. The defect is
 * only visible as a judgement about which artwork belongs on which surface —
 * so what a test can hold is the invariant that both kinds are declared, and
 * that the maskable set has not quietly swallowed the other again.
 *
 * Runs in the desktop-chrome project, which is what CI executes. It reads
 * files and starts no browser, like listing-columns and theme-tokens.
 */
import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'src');

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

function manifest(): { icons: ManifestIcon[] } {
  return JSON.parse(readFileSync(join(SRC, 'manifest.webmanifest'), 'utf8'));
}

/** Icons whose purpose list contains `want`, exactly — not as a substring. */
function withPurpose(icons: ManifestIcon[], want: string): ManifestIcon[] {
  return icons.filter(i => (i.purpose ?? 'any').split(/\s+/).includes(want));
}

test('declares an icon drawn for unmasked surfaces', () => {
  // EXCLUSIVELY "any", not merely containing it.
  //
  // The first version of this test asked for an icon whose purpose list
  // included "any" and passed against the exact bug it was written for:
  // "maskable any" contains "any". It measured the declaration and not the
  // thing that matters, which is that some icon is DRAWN unmasked — and an
  // icon claiming both purposes is drawn for the crop, always.
  //
  // Caught by reverting the manifest to its broken state and re-running.
  const unmasked = manifest().icons.filter(i => (i.purpose ?? 'any').trim() === 'any');
  expect(
    unmasked.length,
    'no icon is declared purpose:"any" alone — unmasked surfaces get the padded maskable tile',
  ).toBeGreaterThan(0);
});

test('still declares a maskable set, so Android launchers keep theirs', () => {
  // The fix must not have been "delete the maskable ones". Android crops
  // whatever it is given; an unmasked icon cropped to a circle loses its
  // corners and part of the mark.
  const maskable = withPurpose(manifest().icons, 'maskable');
  expect(maskable.length, 'no purpose:"maskable" icon left for Android').toBeGreaterThan(0);
});

test('keeps the two sets separate', () => {
  // A single icon declared "maskable any" is what caused this. It claims to
  // serve both surfaces and can only be drawn for one of them.
  const both = manifest().icons.filter(i => {
    const p = (i.purpose ?? 'any').split(/\s+/);
    return p.includes('any') && p.includes('maskable');
  });
  expect(both, 'an icon claims both purposes again — it can only be drawn for one')
    .toEqual([]);
});

test('offers both purposes at the two sizes an installer needs', () => {
  // 192 and 512 are what Chrome requires to consider a PWA installable, and
  // 512 is the splash-screen source. A set missing one of them silently
  // downgrades install quality rather than failing.
  for (const purpose of ['any', 'maskable']) {
    const sizes = withPurpose(manifest().icons, purpose).map(i => i.sizes);
    expect(sizes, `purpose:"${purpose}" is missing 192x192`).toContain('192x192');
    expect(sizes, `purpose:"${purpose}" is missing 512x512`).toContain('512x512');
  }
});

test('every declared icon file exists', () => {
  // The manifest names paths as strings; nothing checks them. A renamed or
  // ungenerated PNG is a 404 the browser answers by falling back to a letter
  // glyph, which looks like a branding mistake rather than a missing file.
  const missing = manifest().icons
    .map(i => i.src)
    .filter(src => !existsSync(join(SRC, src)));
  expect(missing, 'manifest names icon files that do not exist').toEqual([]);
});

test('the unmasked PNGs are rendered from favicon.svg, not drawn again', () => {
  // Not a pixel check — just that the one master both the tab and the "any"
  // set derive from is still present and still the arc-and-arrow. A second
  // copy of the artwork is how this repo previously ended up with the old
  // wordmark inlined in the chat widget.
  const favicon = readFileSync(join(SRC, 'favicon.svg'), 'utf8');
  expect(favicon).toContain('rx="114"');            // rounded ground, unlike the maskable master
  expect(favicon).toContain('#2DD4BF');             // the teal arrow
  expect(favicon).toContain('npm run icons');       // points at the regeneration path
});
