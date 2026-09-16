/**
 * The headline price does not change under the reader.
 *
 * REPORTED, with two screenshots of a single page load on the Baleno:
 *
 *   on paint          ₹6.1L
 *   a few seconds on  ₹6.10 - 10.09 Lakh
 *
 * Both came out of `displayPrice`, which asks in order: the selected trim,
 * then the band across the loaded trims, then the catalogue row's own figure.
 * `variants()` is filled by a separate request for /cars/{id}/variants, so
 * until that lands the cascade falls through to `car.price` — one
 * hand-maintained number on the row — and the reader sees it. When the
 * response arrives the band wins and the headline changes.
 *
 * The flip is the bug, not either number: ₹6.1L is the row's figure and
 * ₹6.10-10.09L is the band, and a buyer who reads the first and looks away
 * has been told the car costs the bottom of its range.
 *
 * The band never needed that request — the row already carries
 * variantPriceMin/Max — so these pin that the FIRST paint is already the
 * final answer.
 */
import { signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { CarDetailComponent } from './car-detail.component';
import { CarsDataService, PLACEHOLDER } from '../../services/cars-data.service';

const PHOTO = 'https://cdn.gaadiiq.test/baleno/front.webp';

/** The Baleno as /cars returns it: row price 6.10L, trims 6.10L - 10.09L. */
function baleno(over: Partial<any> = {}): any {
  return {
    id: 'c5c6b687', make: 'Maruti Suzuki', model: 'Baleno', year: 2026,
    price: 610000, km: 0, fuel: 'Petrol', transmission: 'Manual',
    badge: '', badgeType: '', image: PHOTO, images: [PHOTO],
    rating: 0, reviews: 0, verified: true, bodyType: 'Hatchback',
    isSellerListing: false, fromCatalogue: true,
    variantCount: 10, variantPriceMin: 610000, variantPriceMax: 1009000,
    ...over,
  };
}

function mount(car: any): ComponentFixture<CarDetailComponent> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CarDetailComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ id: car.id }) }, queryParams: { subscribe: () => {} } },
      },
      {
        provide: CarsDataService,
        useValue: {
          cars: signal([car]),
          loading: signal(false),
          getById: (id: string) => (id === car.id ? car : undefined),
          getAll: () => [car],
          reload: async () => {},
          fullCar: async () => null,
          variants: async () => [],
        },
      },
    ],
  });
  return TestBed.createComponent(CarDetailComponent);
}

describe('CarDetailComponent — the headline price does not flip', () => {
  it('shows the band before the trims request has answered', () => {
    // THE REPORTED BUG. `variants()` is deliberately left empty: this is the
    // state the reader sees on paint, and it used to read "₹6.1L".
    const fixture = mount(baleno());
    const c = fixture.componentInstance as any;
    c.car = baleno();

    expect(c.variants().length)
      .withContext('the fixture must model the pre-response state')
      .toBe(0);

    const shown = c.displayPrice();
    expect(shown.amount).toBe(610000);
    expect(shown.text).toContain('10.09');
  });

  it('shows the same thing once the trims arrive', () => {
    // The other half: no change when the response lands. A first paint that
    // is merely different-but-early would still flip.
    const c = mount(baleno()).componentInstance as any;
    c.car = baleno();
    const before = c.displayPrice().text;

    c.variants.set([
      { id: 'v1', car_id: 'c5c6b687', name: 'Sigma', ex_showroom_price: 610000,
        fuel_type: 'Petrol', transmission: 'Manual', status: 'published' },
      { id: 'v2', car_id: 'c5c6b687', name: 'Alpha', ex_showroom_price: 1009000,
        fuel_type: 'Petrol', transmission: 'Manual', status: 'published' },
    ]);

    expect(c.displayPrice().text).toBe(before);
  });

  it('still narrows to the filtered trims once they are loaded', () => {
    // The seeded band must not outrank the filter. Choosing a gearbox has to
    // narrow the headline to the trims still on screen — that behaviour is
    // why the loaded band is asked for first.
    const c = mount(baleno()).componentInstance as any;
    c.car = baleno();
    c.variants.set([
      { id: 'v1', car_id: 'c5c6b687', name: 'Sigma', ex_showroom_price: 610000,
        fuel_type: 'Petrol', transmission: 'Manual', status: 'published' },
      { id: 'v2', car_id: 'c5c6b687', name: 'Alpha AMT', ex_showroom_price: 1009000,
        fuel_type: 'Petrol', transmission: 'AMT', status: 'published' },
    ]);

    c.setGearbox('AMT');

    expect(c.displayPrice().amount).toBe(1009000);
  });

  it('falls back to the row figure for a model with no trim prices', () => {
    // Unchanged behaviour: a row with no band still quotes what it has, and a
    // model with nothing at all still returns null rather than ₹0.
    const c = mount(baleno({ variantPriceMin: undefined, variantPriceMax: undefined }))
      .componentInstance as any;
    c.car = baleno({ variantPriceMin: undefined, variantPriceMax: undefined });

    expect(c.displayPrice().amount).toBe(610000);
  });
});
