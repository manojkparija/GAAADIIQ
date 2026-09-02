/**
 * Admin screens must be painted in theme tokens, not fixed colours.
 *
 * Reported: /admin/variants rendered a white header band directly under a dark
 * navy navbar. The page root had already been converted to `--navy`, but the
 * header, every card, every form field and every button were still the light
 * palette they were written in — `#fff`, `#1f2937`, `#6b7280` — so in dark mode
 * the screen was a white sheet on a dark page. admin-car-images was the same,
 * and it is one click away, linked from the Variants header itself.
 *
 * This reads the stylesheets rather than the rendered page on purpose. These
 * screens sit behind adminGuard, so an e2e test would have to hold an admin
 * session to see them at all — which is exactly why nobody noticed the white
 * band for so long, and why the check that catches a regression here has to be
 * one that runs without signing in.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const PAGES = join(__dirname, '..', 'src', 'app', 'pages');

const SHEETS = [
  'admin-variants/admin-variants.component.scss',
  'admin-car-images/admin-car-images.component.scss',
];

/** Strip comments: they quote the colours that were removed, deliberately. */
function rules(file: string): string {
  return readFileSync(join(PAGES, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');
}

for (const sheet of SHEETS) {
  test(`${sheet} paints surfaces with tokens`, () => {
    const css = rules(sheet);

    // A fixed surface colour is the bug: it cannot follow the theme.
    const backgrounds = [...css.matchAll(/background(-color)?:\s*([^;]+);/g)]
      .map(m => m[2].trim())
      .filter(v => /#[0-9a-fA-F]{3,6}\b|(^|\s)(white|black)(\s|$)/.test(v))
      // A gradient may name brand stops; those are the same in both themes.
      .filter(v => !v.includes('gradient'));

    expect(backgrounds, `fixed surface colours in ${sheet}`).toEqual([]);
  });

  test(`${sheet} sets text colour from tokens`, () => {
    const css = rules(sheet);

    const colours = [...css.matchAll(/(?<!-)\bcolor:\s*([^;]+);/g)]
      .map(m => m[1].trim())
      .filter(v => /#[0-9a-fA-F]{3,6}\b|(^|\s)(white|black)(\s|$)/.test(v))
      // White on a filled brand button is white in both themes; that is the
      // one fixed colour that is correct, and it is always #fff or `white`.
      .filter(v => !/^(#fff|#ffffff|white)$/i.test(v));

    expect(colours, `fixed text colours in ${sheet}`).toEqual([]);
  });
}

test('the toast chip stays dark in both themes', () => {
  // --text flips to near-white in dark mode, so a chip painted with it and
  // captioned in white letters is white-on-white. --ink is #0B1220 in every
  // theme, which is what a dark chip actually wants. This was introduced
  // while converting the sheet and caught by looking at the rendered page.
  for (const sheet of SHEETS) {
    const css = rules(sheet);
    const toast = css.match(/\.\w+-toast\s*\{[^}]*\}/)?.[0] ?? '';

    expect(toast, `${sheet} toast`).toContain('var(--ink)');
    expect(toast).not.toContain('var(--text)');
  }
});

test('no white text is left sitting on a muted fill', () => {
  // Same trap in the other direction: --text-muted is a translucent near-white
  // in dark mode, so white letters on it are unreadable.
  for (const sheet of SHEETS) {
    const css = rules(sheet);
    const blocks = [...css.matchAll(/\{[^}]*\}/g)].map(m => m[0]);

    const bad = blocks.filter(
      b => /background:\s*var\(--text-muted\)/.test(b) && /color:\s*(white|#fff)/i.test(b),
    );

    expect(bad, `${sheet}: white on --text-muted`).toEqual([]);
  }
});
