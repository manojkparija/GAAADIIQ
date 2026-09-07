/**
 * Every brand logo sits on a plate it can actually be seen against.
 *
 * WHAT WAS REPORTED
 *
 * A screenshot of /new-cars in dark mode, circling Toyota, Kia, Lexus, Mini
 * and Jaguar: "logos are not visible in web application". The tiles were
 * there, the names were there, and the marks were black artwork painted
 * directly onto a dark glass card.
 *
 * WHY THE OBVIOUS FIX WAS THE WRONG ONE
 *
 * The home page had already solved this with --logo-chip, a white chip in both
 * themes, and the note beside that token said a light ground "is what every
 * logo in the set was designed to sit on". Measuring the files says otherwise:
 * ten of the marks are light, silver or yellow artwork. Putting the whole grid
 * on a white chip would have fixed thirteen logos and broken those ten — in
 * dark mode, the theme the report came from. So the plate is chosen per logo.
 *
 * WHAT THIS FILE MEASURES, AND WHAT IT CANNOT
 *
 * The classification itself comes from the image pixels and lives in
 * scripts/measure_brand_logo_plates.py, which is where the numbers in
 * brand-logo-plates.ts come from; a browser test cannot re-derive it without
 * decoding all 36 PNGs. What is checked here is the part that regressed: that
 * the grid paints a plate at all, that it is opaque, and that the two
 * polarities are actually different — a chip that quietly resolved to
 * `transparent` would restore the exact reported bug while every ratio in the
 * suite still passed.
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
import { usesDarkPlate, DARK_PLATE_SLUGS } from '../../data/brand-logo-plates';

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

describe('brand logo plates — the classification', () => {
  it('puts a light-artwork mark on the dark plate', () => {
    // Two of the ten, and the two the reporter circled from that group.
    expect(usesDarkPlate('lexus')).toBeTrue();
    expect(usesDarkPlate('genesis')).toBeTrue();
  });

  it('leaves a dark-artwork mark on the default white chip', () => {
    expect(usesDarkPlate('toyota')).toBeFalse();
    expect(usesDarkPlate('audi')).toBeFalse();
  });

  it('defaults an unknown brand to the white chip', () => {
    // A logo an admin uploads later cannot be measured ahead of time. The
    // default has to be the one the home page already ships, so an unknown
    // logo is no worse off than it is today — never undefined behaviour.
    expect(usesDarkPlate('some-brand-added-next-year')).toBeFalse();
    expect(usesDarkPlate(null)).toBeFalse();
    expect(usesDarkPlate(undefined)).toBeFalse();
    expect(usesDarkPlate('')).toBeFalse();
  });

  it('is not thrown by the casing or padding a slug arrives in', () => {
    expect(usesDarkPlate('  Lexus ')).toBeTrue();
  });

  it('keeps the measured set intact', () => {
    // Pins the list itself: dropping a slug here is dropping a logo back into
    // being invisible, and that should be a deliberate edit with a re-run of
    // scripts/measure_brand_logo_plates.py behind it.
    expect([...DARK_PLATE_SLUGS].sort()).toEqual([
      'aston-martin', 'bentley', 'ferrari', 'genesis', 'lexus',
      'lotus', 'renault', 'rolls-royce', 'skoda', 'volvo',
    ]);
  });
});

describe('NewCarsComponent — the brand grid paints those plates', () => {
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
    it(`gives every mark an opaque plate in ${theme} mode`, () => {
      // The regression guard. Before the fix this wrap was a bare flex box
      // with no background at all, which is what made the marks vanish.
      const el = render(theme);
      const wraps = Array.from(el.querySelectorAll<HTMLElement>('.brand-logo-wrap'));
      expect(wraps.length).withContext('no brand tiles rendered').toBe(BRANDS.length);

      for (const wrap of wraps) {
        const bg = getComputedStyle(wrap).backgroundColor;
        expect(alpha(bg))
          .withContext(`[${theme}] a transparent plate is the reported bug: ${bg}`)
          .toBe(1);
      }
    });

    it(`gives the two polarities different plates in ${theme} mode`, () => {
      // If both resolved to the same colour the classification would be
      // decorative — one of the two groups would still be invisible.
      const el = render(theme);
      const light = el.querySelector<HTMLElement>('.brand-logo-wrap:not(.plate-dark)');
      const dark = el.querySelector<HTMLElement>('.brand-logo-wrap.plate-dark');

      expect(light).withContext('Toyota should be on the default chip').toBeTruthy();
      expect(dark).withContext('Lexus should be on the dark plate').toBeTruthy();
      expect(getComputedStyle(light!).backgroundColor)
        .not.toBe(getComputedStyle(dark!).backgroundColor);
    });

    it(`keeps the chip the same colour in ${theme} mode as the home page uses`, () => {
      // The chip is deliberately light in BOTH themes — see the note on
      // --logo-chip. A theme-following chip would put dark marks back on a
      // dark ground the moment someone "fixed" the token to match the card.
      const el = render(theme);
      const light = el.querySelector<HTMLElement>('.brand-logo-wrap:not(.plate-dark)')!;
      expect(getComputedStyle(light).backgroundColor).toBe('rgb(255, 255, 255)');
    });
  });
});
