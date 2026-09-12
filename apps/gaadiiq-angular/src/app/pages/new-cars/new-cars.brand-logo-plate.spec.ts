/**
 * Every brand logo sits on one chip, and that chip is never transparent.
 *
 * WHAT WAS REPORTED, TWICE
 *
 * First, a screenshot of /new-cars in dark mode circling Toyota, Kia, Lexus,
 * Mini and Jaguar: "logos are not visible in web application". The tiles were
 * there, the names were there, and the marks were black artwork painted
 * directly onto a dark glass card.
 *
 * The fix gave the grid the home page's --logo-chip — a white chip in both
 * themes — plus a second polarity, `.plate-dark`, for ten marks measured as
 * light, silver or yellow artwork that washed out on white.
 *
 * Then a second screenshot, light theme, circling exactly those ten: a navy
 * plate among transparent ones reads as a black box.
 *
 * WHY THE SECOND POLARITY IS GONE RATHER THAN RETUNED
 *
 * Not because of how it looked. Because it could not stay correct.
 *
 * The list was keyed on slug and measured from the bundled files in
 * src/assets/brand-logos/. But brands.service.ts resolves a logo as
 * `logo_url ?? assets/brand-logos/<slug>.svg`, and seven of those ten brands
 * have an UPLOADED logo in Supabase storage — confirmed on Admin → Brands,
 * where they read "Uploaded" rather than "Shipped with the app". The plate was
 * therefore chosen by measuring an image the page does not render, and an
 * admin replacing a logo could invert its polarity with nothing in the code
 * able to notice.
 *
 * So the artwork is dark for all of them now, and there is one rule again.
 *
 * WHAT THIS FILE STILL GUARDS
 *
 * The original bug, which is the one that can silently come back: a chip that
 * resolves to `transparent` puts dark marks on a dark card again, and every
 * contrast ratio in the suite would still pass while the grid looked empty.
 * That is checked in both themes, because the chip is deliberately light in
 * both and a "fix" making it follow the theme would restore the bug exactly.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { NewCarsComponent } from './new-cars.component';
import { CarsDataService } from '../../services/cars-data.service';
import { BrandsService } from '../../services/brands.service';

const BRANDS = [
  { name: 'Toyota', slug: 'toyota', logo: 'assets/brand-logos/toyota.png', country: 'Japan' },
  { name: 'Lexus', slug: 'lexus', logo: 'assets/brand-logos/lexus.png', country: 'Japan' },
];

function mount() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [NewCarsComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { queryParams: {} } } },
      {
        provide: CarsDataService,
        useValue: { cars: signal([]), loading: signal(false), failedSources: signal([]) },
      },
      { provide: BrandsService, useValue: { brands: () => BRANDS, loaded: () => true } },
    ],
  });
  return TestBed.createComponent(NewCarsComponent);
}

function alpha(colour: string): number {
  const parts = /rgba?\(([^)]+)\)/.exec(colour);
  if (!parts) return 0;
  const n = parts[1].split(',').map(Number);
  return n.length > 3 ? n[3] : 1;
}

describe('NewCarsComponent — the brand grid chip', () => {
  let host: HTMLElement;

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    host?.remove();
  });

  function render(theme: 'light' | 'dark'): HTMLElement {
    document.documentElement.setAttribute('data-theme', theme);
    const fixture = mount();
    // Attached to the document on purpose: getComputedStyle resolves a custom
    // property against the element's ancestors, and a detached fixture has
    // none — every var() would come back empty and this would measure nothing
    // while appearing to pass.
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
    return host;
  }

  (['light', 'dark'] as const).forEach((theme) => {
    it(`gives every mark an opaque chip in ${theme} mode`, () => {
      // THE REGRESSION GUARD. Before the original fix this wrap was a bare
      // flex box with no background at all, which is what made the marks
      // vanish against the dark card.
      const el = render(theme);
      const wraps = Array.from(el.querySelectorAll<HTMLElement>('.brand-logo-wrap'));
      expect(wraps.length).withContext('no brand tiles rendered').toBe(BRANDS.length);

      for (const wrap of wraps) {
        const bg = getComputedStyle(wrap).backgroundColor;
        expect(alpha(bg))
          .withContext(`[${theme}] a transparent chip is the reported bug: ${bg}`)
          .toBe(1);
      }
    });

    it(`keeps the chip white in ${theme} mode, as the home page has it`, () => {
      // The chip is deliberately light in BOTH themes — see the note on
      // --logo-chip. A theme-following chip would put dark marks back on a
      // dark ground the moment someone "fixed" the token to match the card.
      const el = render(theme);
      for (const wrap of Array.from(el.querySelectorAll<HTMLElement>('.brand-logo-wrap'))) {
        expect(getComputedStyle(wrap).backgroundColor).toBe('rgb(255, 255, 255)');
      }
    });

    it(`gives every mark the SAME chip in ${theme} mode`, () => {
      // The point of removing the second polarity. One brand rendering on a
      // different ground from its neighbours is the second reported bug, and
      // it would return the moment a per-brand class came back.
      const el = render(theme);
      const backgrounds = new Set(
        Array.from(el.querySelectorAll<HTMLElement>('.brand-logo-wrap'))
          .map((w) => getComputedStyle(w).backgroundColor),
      );
      expect(backgrounds.size)
        .withContext(`[${theme}] tiles disagree about their chip: ${[...backgrounds]}`)
        .toBe(1);
    });

    it(`paints no dark plate on any tile in ${theme} mode`, () => {
      // Pins the removal itself. Re-adding the class is a deliberate decision
      // that has to come with an answer to the problem it was removed for:
      // the list cannot see an uploaded logo, so it cannot stay correct.
      const el = render(theme);
      expect(el.querySelectorAll('.plate-dark').length).toBe(0);
    });
  });
});
