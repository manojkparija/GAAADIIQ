/**
 * The same card, the other grid.
 *
 * listings.newcarmodels.spec.ts pins this rule for the /listings grid: a model
 * card quotes the band of its published trims, not the single hand-maintained
 * figure on the catalogue row. The New Cars grid was never corrected, and it
 * is the one the home page links to — so the Fronx card there read
 * "₹9.3L onwards" while the car's own page said "₹6.84 – 11.98 Lakh".
 *
 * "onwards" is what makes it worse rather than merely wrong: it promises that
 * nothing is cheaper, and ₹2.46L of the range sits below it.
 */
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';

import { NewCarsComponent } from './new-cars.component';
import { CarsDataService, Car } from '../../services/cars-data.service';

function car(over: Partial<Car>): Car {
  return {
    id: 'c1', make: 'Maruti Suzuki', model: 'Fronx', year: 2026,
    price: 930000, km: 0, fuel: 'Petrol', transmission: 'Manual',
    image: 'https://cdn.gaadiiq.test/fronx/front.webp',
    images: ['https://cdn.gaadiiq.test/fronx/front.webp'],
    rating: 4, reviews: 10, verified: true, bodyType: 'SUV',
    ...over,
  } as Car;
}

function build(cars: Car[]): any {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [NewCarsComponent],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: CarsDataService,
        useValue: { cars: signal(cars), loading: signal(false), reload: async () => {} },
      },
    ],
  });
  return TestBed.createComponent(NewCarsComponent).componentInstance;
}

/** The Fronx as the catalogue actually holds it. */
const FRONX = { price: 930000, variantCount: 14, variantPriceMin: 684000, variantPriceMax: 1198000 };

describe('New Cars grid — what a model card quotes', () => {
  it('starts the band at the cheapest trim', () => {
    const m = build([car(FRONX)]).newCarModels()[0];

    expect(m.minPrice).toBe(684000);
    expect(m.maxPrice).toBe(1198000);
  });

  it('does not quote the catalogue row figure', () => {
    // ₹9.3L is a real number on the row; it is simply not the starting price.
    const m = build([car(FRONX)]).newCarModels()[0];

    expect(m.minPrice).not.toBe(930000);
  });

  it('renders the band rather than an "onwards" promise it breaks', () => {
    const comp = build([car(FRONX)]);
    const m = comp.newCarModels()[0];

    expect(comp.formatPriceRange(m.minPrice, m.maxPrice)).toBe('₹6.8L – ₹12.0L');
  });

  it('falls back to the row for a model whose trims are not entered yet', () => {
    // That figure is the only price such a car has; showing nothing would be
    // worse than showing the one number an admin typed.
    const m = build([
      car({ variantPriceMin: undefined, variantPriceMax: undefined, variantCount: 0 }),
    ]).newCarModels()[0];

    expect(m.minPrice).toBe(930000);
    expect(m.maxPrice).toBe(930000);
  });

  it('spans the model-years of one model', () => {
    // The catalogue holds one row per model-year, and one card stands for all
    // of them.
    const m = build([
      car({ id: 'a', year: 2024, price: 800000, variantPriceMin: 700000, variantPriceMax: 900000 }),
      car({ id: 'b', year: 2026, ...FRONX }),
    ]).newCarModels()[0];

    expect(m.minPrice).toBe(684000);
    expect(m.maxPrice).toBe(1198000);
  });

  it('sorts Price: Low to High on the trim price, not the row price', () => {
    // A model whose row reads ₹9.3L but whose entry trim is ₹6.84L belongs
    // ahead of one that genuinely starts at ₹8L.
    const comp = build([
      car({ id: 'a', model: 'Fronx', ...FRONX }),
      car({
        id: 'b', model: 'Brezza', price: 850000,
        variantPriceMin: 800000, variantPriceMax: 1400000,
      }),
    ]);
    comp.selectedSort.set('Price: Low to High');

    expect(comp.newCarModels().map((m: any) => m.model)).toEqual(['Fronx', 'Brezza']);
  });
});
