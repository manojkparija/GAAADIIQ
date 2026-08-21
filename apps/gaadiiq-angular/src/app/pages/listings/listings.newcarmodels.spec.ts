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
import { signal } from '@angular/core';
import { ListingsComponent } from './listings.component';
import { CarsDataService, Car } from '../../services/cars-data.service';

function car(over: Partial<Car>): Car {
  return {
    id: 'c1', make: 'Maruti Suzuki', model: 'Fronx', year: 2026,
    price: 930000, km: 0, fuel: 'Petrol', transmission: 'Manual',
    image: 'assets/cars/placeholder.svg', images: [],
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
