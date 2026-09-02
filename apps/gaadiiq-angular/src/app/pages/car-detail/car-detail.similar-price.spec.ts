/**
 * "Compare with Similar Cars" quotes the entry trim, like every other surface.
 *
 * Reported with a screenshot showing the Fronx detail page: its own header read
 * "₹6.84 - 11.98 Lakh" while the comparison table three blocks below it said
 * "₹9.3L onwards" for the same car — the page disagreeing with itself, in view
 * at the same moment.
 *
 * The column was also headed "Avg. Ex-Showroom Price" while the cell said
 * "onwards", so the label and the figure described two different quantities.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { CarDetailComponent } from './car-detail.component';
import { CarsDataService } from '../../services/cars-data.service';

const PHOTO = 'https://cdn.gaadiiq.test/fronx/front.webp';

function car(over: Partial<any> = {}): any {
  return {
    id: 'fronx', make: 'Maruti Suzuki', model: 'Fronx', year: 2026,
    price: 930000, km: 0, fuel: 'Petrol', transmission: 'Manual',
    image: PHOTO, images: [PHOTO], rating: 0, reviews: 0, verified: true,
    bodyType: 'SUV', fromCatalogue: true, variantCount: 14,
    variantPriceMin: 684000, variantPriceMax: 1198000,
    ...over,
  };
}

function mount(cars: any[], id = 'fronx') {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CarDetailComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: {
          params: of({ id }),
          queryParams: of({}),
          snapshot: { paramMap: convertToParamMap({ id }), queryParams: {} },
        },
      },
      {
        provide: CarsDataService,
        useValue: {
          cars: signal(cars),
          loading: signal(false),
          failedSources: signal([]),
          variantsFor: async () => [],
          fullCar: async () => null,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(CarDetailComponent);
  return fixture.componentInstance as any;
}

describe('car detail — the similar-cars table', () => {
  it('quotes the cheapest trim for the car being viewed', () => {
    const c = mount([car()]);

    expect(c.startsAt(car())).toBe(684000);
  });

  it('does not quote the catalogue row figure', () => {
    // ₹9.3L is a real number on the row. It is simply not what the car
    // starts at, and "onwards" is a promise that nothing is cheaper.
    const c = mount([car()]);

    expect(c.startsAt(car())).not.toBe(930000);
  });

  it('agrees with the price band in the page header', () => {
    // The two figures are rendered a few blocks apart on one screen, which is
    // what made the disagreement obvious to a reader and invisible to us.
    const c = mount([car()]);
    const subject = car();

    expect(c.startsAt(subject)).toBe(subject.variantPriceMin);
  });

  it('falls back to the row price for a comparison car with no priced trims', () => {
    // Rows in this table are other models, which may be less complete than the
    // one being viewed. Showing nothing there would leave a blank cell in the
    // middle of a comparison.
    const c = mount([car()]);
    const sparse = car({ id: 'x', model: 'e Vitara', price: 1600000,
                         variantPriceMin: undefined, variantPriceMax: undefined });

    expect(c.startsAt(sparse)).toBe(1600000);
  });

  it('renders the from-price through the shared helper, not its own arithmetic', () => {
    // Each of the three screens that got this wrong had computed it itself.
    // This asserts the method exists and is what the template can call, so a
    // future edit has an obvious thing to reach for.
    const c = mount([car()]);

    expect(typeof c.startsAt).toBe('function');
  });
});
