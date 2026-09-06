/**
 * The listing-type options are readable in dark mode.
 *
 * WHAT THIS PREVENTS COMING BACK
 *
 * Reported with a screenshot: "letters not visible in dark mode", circling the
 * unselected "New car" option on the listing form. The card was there, its
 * border was there, and the title was near-black on the dark navy background.
 *
 * THE MECHANISM, WHICH IS THE REUSABLE PART
 *
 * `.lt-btn` set `background: var(--bg)` and no `color`. A `<button>` does not
 * inherit colour from its parent the way a `<div>` does — with no rule of its
 * own it falls back to the user agent's `buttontext`, which is near-black in
 * both themes. So the background followed the theme and the text did not.
 *
 * `.lt-sub` was legible throughout, because it names `--text-muted`. Only the
 * title, which set no colour at all, disappeared. That is the tell: a themed
 * background under unthemed text.
 *
 * WHY THIS TEST AND NOT e2e/contrast.spec.ts
 *
 * That sweep walks the rendered DOM and is the right place for this, but it
 * runs light theme only — dark still has around twenty failures from
 * hardcoded hexes that predate the tokens, so a dark run cannot be green yet
 * and would not have caught this. It also cannot reach this page: /list-car
 * sits behind the sign-in guard, which is a large part of why nobody saw the
 * bug in a browser.
 *
 * Karma loads src/styles.scss (see angular.json), so the real tokens are live
 * here and the ratio below is measured from computed styles rather than
 * asserted from the stylesheet source.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ListCarComponent } from './list-car.component';

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

describe('ListCarComponent — the listing-type options in dark mode', () => {
  let host: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ListCarComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    document.documentElement.setAttribute('data-theme', 'dark');
  });

  afterEach(() => {
    // Leave the page in the theme every other spec expects.
    document.documentElement.removeAttribute('data-theme');
    host?.remove();
  });

  function renderInDocument(): HTMLElement {
    const fixture = TestBed.createComponent(ListCarComponent);
    // Attached to the document on purpose: getComputedStyle resolves a CSS
    // custom property against the element's ancestors, and a detached fixture
    // has none — every var() would come back empty and the test would measure
    // nothing while appearing to pass.
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
    return host;
  }

  it('gives the unselected option text an explicit colour', () => {
    // The bug in one assertion. Without a colour of its own the button falls
    // back to the UA default, which does not follow the theme.
    const el = renderInDocument();
    const inactive = Array.from(el.querySelectorAll('.lt-btn')).find(
      (b) => !b.classList.contains('active'),
    ) as HTMLElement;

    expect(inactive).withContext('no unselected listing-type option to check').toBeTruthy();

    const title = inactive.querySelector('.lt-title') as HTMLElement;
    const fg = getComputedStyle(title).color;
    const bg = getComputedStyle(inactive).backgroundColor;

    const ratio = contrastRatio(fg, bg);
    expect(ratio)
      .withContext(`"${title.textContent?.trim()}" is ${fg} on ${bg} — ratio ${ratio.toFixed(2)}`)
      .toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the selected option readable too', () => {
    // The selected card paints its own gradient and sets its own white text,
    // so it was never the reported problem — but a later change to the
    // unselected colour must not be made by loosening this one.
    const el = renderInDocument();
    const active = el.querySelector('.lt-btn.active') as HTMLElement;
    expect(active).withContext('no selected listing-type option to check').toBeTruthy();

    const title = active.querySelector('.lt-title') as HTMLElement;
    const fg = getComputedStyle(title).color;

    // The gradient is not a single colour, so the darkest stop it uses is the
    // honest thing to measure against — #2563EB, the left end of the ramp.
    const ratio = contrastRatio(fg, 'rgb(37, 99, 235)');
    expect(ratio)
      .withContext(`selected title is ${fg} on the gradient — ratio ${ratio.toFixed(2)}`)
      .toBeGreaterThanOrEqual(4.5);
  });
});
