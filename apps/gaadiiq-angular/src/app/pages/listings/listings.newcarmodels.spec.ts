/**
 * A New Cars card quotes the published trims, not the catalogue row.
 *
 * The bug this pins: the card read `car.price` — one hand-maintained figure on
 * the catalogue row — and counted rows rather than trims. A Fronx with
 * seventeen published trims spanning ₹6.84–11.98 L therefore rendered
 * "₹9.30L onwards · 1 Variant", while its own detail page, which reads the
 * trims, said "₹6.84 - 11.98 Lakh". Two screens of the same site contradicting
 * each other on the first number a buyer looks at.
 *
 * Both halves are asserted together because they had the same cause and a fix
 * to one alone still leaves the card wrong.
 */
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
// ListingsComponent injects HttpClient for the admin remove control. Without a
// provider every test here dies in the injector before reaching its subject —
// which is what happened, unnoticed, because CI runs Playwright but never
// `ng test`.
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ListingsComponent } from './listings.component';
import { CarsDataService, Car } from '../../services/cars-data.service';

function car(over: Partial<Car>): Car {
  return {
    id: 'c1', make: 'Maruti Suzuki', model: 'Fronx', year: 2026,
    price: 930000, km: 0, fuel: 'Petrol', transmission: 'Manual',
    // A real photograph, not the placeholder: the grid now hides a model
    // that has none, and these tests are about the price band and the trim
    // count. With a placeholder they would pass or fail on the photograph
    // rule instead of on their own subject.
    image: 'https://cdn.gaadiiq.test/fronx/front.webp',
    images: ['https://cdn.gaadiiq.test/fronx/front.webp'],
    rating: 4, reviews: 10, verified: true, bodyType: 'SUV',
    ...over,
  } as Car;
}

function build(cars: Car[]): ListingsComponent {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ListingsComponent],
    providers: [
      provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      {
        provide: CarsDataService,
        useValue: { cars: signal(cars), loading: signal(false) },
      },
    ],
  });
  return TestBed.createComponent(ListingsComponent).componentInstance;
}

describe('listings — New Cars model cards', () => {
  it('quotes the trim band, not the catalogue price', () => {
    const comp = build([
      car({ price: 930000, variantCount: 17, variantPriceMin: 684000, variantPriceMax: 1198000 }),
    ]);

    const [m] = comp.newCarModels();
    expect(m.minPrice).toBe(684000);
    expect(m.maxPrice).toBe(1198000);
    // The stale catalogue figure must not survive anywhere in the band.
    expect(m.minPrice).not.toBe(930000);
  });

  it('counts published trims, not catalogue rows', () => {
    const comp = build([
      car({ price: 930000, variantCount: 17, variantPriceMin: 684000, variantPriceMax: 1198000 }),
    ]);

    expect(comp.newCarModels()[0].variantCount).toBe(17);
  });

  it('sums trims across the model-years of one model', () => {
    // The catalogue holds one row per model-year, so a model can be two rows.
    const comp = build([
      car({ id: 'a', year: 2024, price: 800000, variantCount: 5, variantPriceMin: 700000, variantPriceMax: 900000 }),
      car({ id: 'b', year: 2026, price: 930000, variantCount: 17, variantPriceMin: 684000, variantPriceMax: 1198000 }),
    ]);

    const [m] = comp.newCarModels();
    expect(m.variantCount).toBe(22);
    expect(m.minPrice).toBe(684000);
    expect(m.maxPrice).toBe(1198000);
  });

  it('falls back to the catalogue price when no trim is priced', () => {
    // Not a regression guard for its own sake: this is the only price such a
    // car has, and dropping to 0 would render "₹0.00L onwards".
    const comp = build([car({ price: 930000, variantCount: 0 })]);

    const [m] = comp.newCarModels();
    expect(m.minPrice).toBe(930000);
    expect(m.maxPrice).toBe(930000);
    expect(m.variantCount).toBe(1);
  });
});

/**
 * The variants drill-down agrees with the card that opened it.
 *
 * The card was fixed in #116 and this view was not, so clicking "Explore
 * Variants" on a card reading "₹6.84L – ₹11.98L · 12 Variants" landed on a
 * page headed "1 variant" quoting "₹9.30L". One click, two contradictory
 * answers about the same car.
 */
describe('listings — variants drill-down', () => {
  function open(cars: Car[]): ListingsComponent {
    const comp = build(cars);
    comp.selectedModel.set('Maruti Suzuki||Fronx');
    return comp;
  }

  it('counts published trims, not catalogue rows', () => {
    const comp = open([
      car({ price: 930000, variantCount: 12, variantPriceMin: 684000, variantPriceMax: 1198000 }),
    ]);
    expect(comp.selectedModelTrimCount()).toBe(12);
  });

  it('quotes the trim band on each row', () => {
    const comp = open([
      car({ price: 930000, variantCount: 12, variantPriceMin: 684000, variantPriceMax: 1198000 }),
    ]);
    const row = comp.newModelVariants()[0];

    expect(comp.variantCardPrice(row)).toBe('₹6.84L – ₹11.98L');
    expect(comp.variantCardPrice(row)).not.toContain('9.30');
    // "EMI from" should be from the cheapest trim, not the catalogue figure.
    expect(comp.variantEmiBase(row)).toBe(684000);
  });

  it('falls back to the catalogue price when a row has no priced trims', () => {
    const comp = open([car({ price: 930000, variantCount: 0 })]);
    const row = comp.newModelVariants()[0];

    expect(comp.variantCardPrice(row)).toBe('₹9.30L');
    expect(comp.variantEmiBase(row)).toBe(930000);
    expect(comp.selectedModelTrimCount()).toBe(1);
  });
});
