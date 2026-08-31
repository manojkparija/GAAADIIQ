/**
 * Every CSS variable the stylesheets read is one that is actually defined.
 *
 * REPORTED FROM THE PHONE, TWICE IN ONE SCREENSHOT
 *
 * The AI Advisor's one-line field was a white box you could type into and see
 * nothing come out of. Its rule:
 *
 *     background: var(--bg,   #fff);
 *     color:      var(--text, #111);
 *
 * `--text` is a real token and follows the theme, resolving to #F1F5F9 in
 * dark. `--bg` was defined nowhere, so it always took the #fff fallback.
 * Near-white letters on a white box.
 *
 * The fallback is what hid it. `var(--bg, #fff)` READS like a themed value
 * with a sensible default; nothing on the line says the default is the only
 * branch that has ever run. 29 declarations were in that state, and one had
 * already been patched locally with a comment naming the trap — the trap was
 * left in place for the other 28.
 *
 * `--border` was the same in 15 files, and worse: 37 of its uses have no
 * fallback at all, so the declaration was invalid and border-colour fell back
 * to inherited.
 *
 * WHY THIS IS STATIC
 *
 * An undefined custom property is valid CSS. It resolves — to its fallback, or
 * to nothing — at run time in the browser, so neither `ng build` nor the SCSS
 * compiler can object, and a rendered-page check would only catch the handful
 * of tokens that happen to be on screen in the theme under test.
 *
 * So this reads source, like listing-columns.spec.ts: no browser, no API, and
 * it names the token and every file that wanted it.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '..', 'src');

/** Comments are stripped: this file's own prose names tokens it is not using,
 *  and so do the notes left where an earlier one of these bugs was fixed. */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

function stylesheets(dir: string, out: { path: string; text: string }[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) stylesheets(full, out);
    else if (/\.(scss|css|html)$/.test(entry.name)) {
      out.push({
        path: path.relative(SRC, full),
        text: withoutComments(fs.readFileSync(full, 'utf8')),
      });
    }
  }
  return out;
}

/** Does this fallback hardcode a colour? Those are the ones that cannot follow
 *  the theme — a length or a font stack taking its default is harmless. */
function isColour(fallback: string): boolean {
  return /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(|\b(?:white|black|transparent)\b/i.test(
    fallback,
  );
}

/**
 * Tokens defined anywhere: the global stylesheet, or a component's own :host.
 *
 * Component-scoped definitions count — voice-mode defines its whole --vm-*
 * palette locally and is entirely correct to.
 */
function defined(files: { text: string }[]): Set<string> {
  const names = new Set<string>();
  for (const f of files) {
    for (const m of f.text.matchAll(/(?:^|[;{]|\*\/)\s*(--[a-z0-9-]+)\s*:/gim)) names.add(m[1]);
  }
  return names;
}

/**
 * Reads of var(), split by whether taking the fallback is a real fault.
 *
 * No fallback at all is always one: the declaration is invalid and the
 * property falls back to inherited or initial. A COLOUR fallback is the other:
 * a hardcoded colour cannot follow the theme, which is exactly how --bg stayed
 * #fff while --text went near-white.
 *
 * A length or font-stack fallback is a deliberate override hook (--cs-pad's
 * `10px 14px`) and is left alone.
 */
function used(files: { path: string; text: string }[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const f of files) {
    for (const m of f.text.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,([^()]|\([^()]*\))*)?\)/g)) {
      const fallback = (m[2] ?? '').replace(/^,/, '').trim();
      if (fallback && !isColour(fallback)) continue;
      const list = map.get(m[1]) ?? [];
      if (!list.includes(f.path)) list.push(f.path);
      map.set(m[1], list);
    }
  }
  return map;
}

test.describe('theme tokens', () => {
  test('every token read by a stylesheet is defined somewhere', () => {
    const files = stylesheets(SRC);
    const have = defined(files);

    const missing = [...used(files).entries()]
      .filter(([name]) => !have.has(name))
      .map(([name, where]) => `${name} — read in ${where.sort().join(', ')}`)
      .sort();

    expect(
      missing,
      'Each of these either hardcodes a COLOUR that cannot follow the theme, ' +
        'or has no fallback at all and makes the declaration invalid. That is ' +
        'how --bg stayed #fff while --text went near-white and the AI Advisor ' +
        'input became unreadable.',
    ).toEqual([]);
  });

  test('--bg is opaque in every theme block', () => {
    // It backs inputs, dropdown panels and modals. A translucent value shows
    // the page through them — which is the second fault in the same
    // screenshot: the "Get this fixed" sheet at rgba(255,255,255,0.04).
    const styles = fs.readFileSync(path.join(SRC, 'styles.scss'), 'utf8');
    const values = [...styles.matchAll(/^\s*--bg:\s*([^;]+);/gm)].map(m => m[1].trim());

    expect(values.length, 'one per theme block: light, media dark, [data-theme] dark and light')
      .toBe(4);
    for (const v of values) expect(v).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  test('--bg actually changes between light and dark', () => {
    // A token with the same value in both blocks is not theme-aware; it only
    // looks like it is, which is the failure mode this whole file is about.
    const styles = fs.readFileSync(path.join(SRC, 'styles.scss'), 'utf8');
    const values = [...styles.matchAll(/^\s*--bg:\s*([^;]+);/gm)].map(m => m[1].trim());

    expect(new Set(values).size).toBeGreaterThan(1);
  });

  test('a panel over page content never uses the translucent card token', () => {
    // --card-bg is rgba(255,255,255,0.04) in dark by design: it is a card ON a
    // page, tinted by it. A modal or dropdown is not — it must hide what is
    // behind it, and using --card-bg there is what produced the overlapping,
    // unreadable "Get this fixed" sheet.
    const offenders: string[] = [];
    for (const f of stylesheets(SRC)) {
      for (const m of f.text.matchAll(
        /\.(sc-modal|history-panel|[a-z-]*(?:modal|overlay-panel|dropdown|menu-panel))\b[^{]*\{[^}]*background:\s*var\(--card-bg/gm,
      )) {
        offenders.push(`${f.path}: ${m[1]}`);
      }
    }

    expect(offenders, 'these would show the page through them in dark mode').toEqual([]);
  });
});
