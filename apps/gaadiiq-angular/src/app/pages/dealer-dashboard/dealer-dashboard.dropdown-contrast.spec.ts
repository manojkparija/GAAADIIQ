/**
 * The enquiry dropdowns are readable — the control and the popup.
 *
 * WHAT WAS REPORTED
 *
 * A screenshot of the Enquiries tab with the dealer <select> open, annotated
 * "blue teal in white letters are not visible". Every row of the popup was
 * blank except the highlighted one.
 *
 * TWO FAULTS, ONE MISSING RULE
 *
 * Both selects carry class `enq-status`, and `.enq-status` was never defined
 * anywhere — grep across every stylesheet in the app returned nothing. So they
 * were unstyled user-agent controls, and that produced two different failures
 * at once:
 *
 *   - The CLOSED control. A <select> does not inherit `color`; with no rule of
 *     its own it falls back to the UA `buttontext`, near-black, on a dark glass
 *     card. Same mechanism as the <button> bug on /list-car.
 *   - The OPEN popup. Its <option> rows DID pick up the page's white text, and
 *     the popup surface is the system's own white. White on white. Only
 *     `option:checked` had a rule — `--dropdown-hi` with white text — which is
 *     exactly why the highlighted row was the one legible row in the shot.
 *
 * WHY THE POPUP FIX IS GLOBAL
 *
 * Only three pages painted `option` themselves (used-cars, list-car, listings).
 * Every other native select in the app carried the same exposure and was one
 * screenshot away from the same report, so `styles.scss` now paints `option`
 * from `--dropdown-bg` / `--text` for all of them. The three that paint their
 * own still win: a component-scoped rule carries Angular's attribute selector
 * and outranks the global one, so nothing already deliberate changed.
 *
 * WHY KARMA AND NOT e2e/contrast.spec.ts
 *
 * That sweep walks the rendered DOM, but light theme only, and it cannot reach
 * this page at all — the dashboard sits behind a guard. It also cannot see
 * inside a native <select> popup in any browser; the popup is drawn by the OS.
 * What is measurable is the colour the rules resolve to on the elements, which
 * is what fails when a rule is missing, so that is what this measures — from
 * computed styles, with styles.scss live (angular.json loads it into Karma).
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { DealerDashboardComponent } from './dealer-dashboard.component';
import { SupabaseService } from '../../services/supabase.service';
import { AuthService } from '../../services/auth.service';
import { Seller } from '../../services/sellers.service';

/** WCAG relative luminance of an "rgb(r, g, b)" string. */
function luminance(colour: string): number {
  const parts = /rgba?\(([^)]+)\)/.exec(colour);
  if (!parts) throw new Error(`unparseable colour: ${colour}`);
  const [r, g, b] = parts[1].split(',').slice(0, 3).map(Number);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg) + 0.05;
  const b = luminance(bg) + 0.05;
  return Math.max(a, b) / Math.min(a, b);
}

function rgba(colour: string): [number, number, number, number] {
  const parts = /rgba?\(([^)]+)\)/.exec(colour);
  if (!parts) return [0, 0, 0, 0];
  const n = parts[1].split(',').map(Number);
  return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
}

/**
 * The page background for the theme currently set, as [r, g, b].
 *
 * Read from the --navy token rather than from getComputedStyle(document.body).
 * MEASURED: in Karma, with data-theme="dark" on <html>, --navy resolves to
 * #0B1220 on both <html> and <body> while body's computed backgroundColor
 * still comes back as the light #F4F7FB. The token is the value the rule is
 * written against and the one the app paints, so that is what is measured
 * against here; trusting body's computed colour would measure dark-mode text
 * on a light-mode surface and fail something the browser renders correctly.
 */
function canvas(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--navy').trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(raw);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const [r, g, b, a] = rgba(raw);
  return a > 0 ? [r, g, b] : [255, 255, 255];
}

/**
 * The colour a pixel actually is, not the colour the element declares.
 *
 * The dashboard's controls sit on translucent fills — --fill-dim is
 * rgba(255,255,255,.03) — so reading backgroundColor off the element alone
 * measures a wash rather than a surface, and reports a 1.0 ratio for text that
 * is perfectly legible in a browser. Composite up the ancestor chain onto the
 * page background instead, which is what an eye sees.
 */
function effectiveBackground(el: HTMLElement): string {
  const layers: [number, number, number, number][] = [];
  // Stops before <body> for the reason in canvas() above.
  let node: HTMLElement | null = el;
  while (node && node !== document.body) {
    const [r, g, b, a] = rgba(getComputedStyle(node).backgroundColor);
    if (a > 0) {
      layers.unshift([r, g, b, a]);
      if (a >= 1) break;
    }
    node = node.parentElement;
  }
  // Nothing opaque anywhere up the chain. In a Karma fixture nothing paints
  // the page canvas, so fall back to the theme's own --bg rather than to
  // white: assuming white here would measure dark mode against a background
  // it never has, and report a failure the browser does not show.
  let [cr, cg, cb] = layers.length && layers[0][3] >= 1 ? layers[0] : canvas();
  for (const [r, g, b, a] of layers) {
    cr = r * a + cr * (1 - a);
    cg = g * a + cg * (1 - a);
    cb = b * a + cb * (1 - a);
  }
  return `rgb(${Math.round(cr)}, ${Math.round(cg)}, ${Math.round(cb)})`;
}

const DEALER: Seller = {
  id: 4, name: 'A Real Person', business_name: 'Mehta Premium Cars',
  phone: '+919000000000', email: 'real@dealer.example', city: 'Pune',
  address: 'Somewhere', verified: true, rating: 4.1, total_reviews: 9,
};

function supabaseStub() {
  const builder = {
    select: () => builder,
    order: () => Promise.resolve({ data: [], error: null }),
    eq: () => Promise.resolve({ data: [], error: null }),
    update: () => builder,
    single: () => Promise.resolve({ data: null, error: null }),
  };
  return {
    client: {
      from: () => builder,
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
}

describe('DealerDashboardComponent — the enquiry dropdowns', () => {
  let host: HTMLElement;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DealerDashboardComponent, RouterTestingModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SupabaseService, useValue: supabaseStub() },
        {
          provide: AuthService,
          useValue: {
            currentUser: () => ({ role: 'admin', name: 'Admin', email: 'a@example.com' }),
            isAdmin: () => true,
          },
        },
      ],
    });
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    host?.remove();
  });

  /** Render the Enquiries tab with one enquiry and one dealer to assign it to. */
  function renderEnquiriesTab(theme: 'light' | 'dark'): HTMLElement {
    document.documentElement.setAttribute('data-theme', theme);
    const fixture = TestBed.createComponent(DealerDashboardComponent);
    const c = fixture.componentInstance;
    c.activeTab.set('enquiries');
    c.enquiriesLoading.set(false);
    c.enquiriesError.set('');
    c.enquiries.set([
      {
        id: 'e1', car_id: 'c1', buyer_name: 'A Buyer', buyer_phone: '9000000000',
        buyer_email: null, notes: null, created_at: new Date().toISOString(),
        assigned_seller_id: null, assigned_to_dealer_at: null,
      } as never,
    ]);
    c.assignableSellers.set([DEALER]);

    // Attached to the document on purpose: getComputedStyle resolves a CSS
    // custom property against the element's ancestors, and a detached fixture
    // has none — every var() would come back empty and this would measure
    // nothing while appearing to pass.
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
    return host;
  }

  function selects(el: HTMLElement): HTMLSelectElement[] {
    return Array.from(el.querySelectorAll<HTMLSelectElement>('select.enq-status'));
  }

  /** A token from the current theme, as an "rgb(r, g, b)" string. */
  function token(name: string): string {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(raw);
    // A token written as rgba() comes back with the author's own spacing,
    // while a computed style is always normalised — compare like with like.
    if (!hex) return raw.replace(/\s+/g, '');
    const n = parseInt(hex[1], 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  }

  (['light', 'dark'] as const).forEach((theme) => {
    it(`paints the closed control from the theme, not the user agent, in ${theme} mode`, () => {
      // WHY THIS ASSERTS COLOURS AND NOT A CONTRAST RATIO
      //
      // A ratio was tried first and could not see the bug: with the fix
      // reverted the whole suite still passed. An unstyled <select> computes
      // to the UA's own buttonface/buttontext, which are a legible pair on
      // their own — the fault is that they are the WRONG pair, fixed grey-on-
      // black that ignores the theme and lands on a dark glass card. So what
      // is measured is that the control takes the theme's tokens. Revert
      // .enq-status and this fails, which is the whole point of writing it.
      const el = renderEnquiriesTab(theme);
      const found = selects(el);
      expect(found.length).withContext('expected both the status and dealer selects').toBe(2);

      for (const sel of found) {
        const style = getComputedStyle(sel);
        expect(style.color)
          .withContext(`[${theme}] the control's text must follow --text`)
          .toBe(token('--text'));
        expect(style.backgroundColor.replace(/\s+/g, ''))
          .withContext(`[${theme}] the control's fill must follow --fill-dim`)
          .toBe(token('--fill-dim'));
      }
    });

    it(`paints the popup rows from the theme in ${theme} mode`, () => {
      // The reported half. Without the global rule an <option> inherits the
      // page's text colour onto the system's white popup surface — white on
      // white in dark mode, which is what the screenshot showed. The popup
      // itself is drawn by the OS and is not in the DOM, so the colours the
      // rule resolves to are the most that can be measured here.
      const el = renderEnquiriesTab(theme);
      const options = Array.from(el.querySelectorAll<HTMLOptionElement>('select.enq-status option'));
      expect(options.length).withContext('no options rendered to check').toBeGreaterThan(1);

      for (const opt of options) {
        const style = getComputedStyle(opt);
        expect(style.backgroundColor)
          .withContext(`[${theme}] "${opt.textContent?.trim()}" must sit on --dropdown-bg`)
          .toBe(token('--dropdown-bg'));
        expect(style.color)
          .withContext(`[${theme}] "${opt.textContent?.trim()}" must follow --text`)
          .toBe(token('--text'));
      }
    });

    it(`keeps those two theme colours legible against each other in ${theme} mode`, () => {
      // Having pinned which tokens are used, this is the part that says the
      // pair is actually readable — so a later change to --text or
      // --dropdown-bg cannot quietly reintroduce the reported bug.
      renderEnquiriesTab(theme);
      const ratio = contrastRatio(token('--text'), token('--dropdown-bg'));
      expect(ratio)
        .withContext(`[${theme}] --text on --dropdown-bg — ratio ${ratio.toFixed(2)}`)
        .toBeGreaterThanOrEqual(4.5);
    });

    it(`keeps the closed control legible on the card in ${theme} mode`, () => {
      // --fill-dim is translucent, so the control's own colour is not the
      // surface: composite it onto the page background to get the pixel.
      const el = renderEnquiriesTab(theme);
      const sel = selects(el)[0];
      const fg = getComputedStyle(sel).color;
      const bg = effectiveBackground(sel);
      const ratio = contrastRatio(fg, bg);
      expect(ratio)
        .withContext(`[${theme}] control text ${fg} on ${bg} — ratio ${ratio.toFixed(2)}`)
        .toBeGreaterThanOrEqual(4.5);
    });

    it(`keeps the highlighted row readable in ${theme} mode`, () => {
      // The one row that always worked, because option:checked already had a
      // rule — which is exactly why the bug hid. White on --dropdown-hi
      // (#0F766E) is 4.76:1; --teal would have been 2.3:1.
      renderEnquiriesTab(theme);
      const ratio = contrastRatio('rgb(255, 255, 255)', token('--dropdown-hi'));
      expect(ratio)
        .withContext(`[${theme}] selected row: white on --dropdown-hi — ratio ${ratio.toFixed(2)}`)
        .toBeGreaterThanOrEqual(4.5);
    });
  });
});
