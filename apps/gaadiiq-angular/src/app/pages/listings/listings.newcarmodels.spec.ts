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

/**
 * The fuel filter on Browse sees the trims, not just the catalogue row.
 *
 * REPORTED, with two screenshots taken minutes apart:
 *
 *   New Cars, Fuel = CNG   ->  "7 models found", cards reading "Petrol / CNG"
 *   Browse,   Fuel = CNG   ->  "0 models available"
 *
 * Same catalogue, same filter, opposite answers — so the data was never the
 * problem, and neither was the API. The New Cars grid had already been taught
 * to read `variantFuels`, the fuels of the published trims. This grid was not.
 * It built its fuel string from `c.fuel` alone, the one hand-maintained value
 * on the catalogue row, and an Alto K10 row says "Petrol" while its trims
 * include CNG. So ticking CNG removed precisely the models that have it.
 *
 * The two grids group the same rows into the same models for the same page of
 * the site, which is why the matcher now lives in utils/fuel.ts rather than
 * being written out twice. They had already drifted apart once before, on
 * photographs (see the note on `rep` above).
 */
describe('listings — the fuel filter reads the published trims', () => {
  /** The Alto K10 as the API describes it: row says Petrol, trims say both. */
  const altoK10 = (over: Partial<Car> = {}) => car({
    id: 'alto-2026', model: 'Alto K10', year: 2026, price: 370000,
    bodyType: 'Hatchback', fuel: 'Petrol',
    variantFuels: ['Petrol', 'CNG'],
    ...over,
  } as Partial<Car>);

  it('keeps a model whose trims include CNG though the row says Petrol', () => {
    // THE REPORTED BUG.
    const comp = build([altoK10()]);
    comp.selectedFuel.set('CNG');

    expect(comp.newCarModels().map(m => m.model)).toEqual(['Alto K10']);
  });

  it('shows both fuels on the card, as New Cars does', () => {
    // The same value drives the chip the reader sees. Before this the card
    // said "Petrol" on a car the detail page describes as "Petrol · CNG".
    const comp = build([altoK10()]);

    expect(comp.newCarModels()[0].fuel).toContain('CNG');
  });

  it('does not hand CNG a petrol-only model', () => {
    // A filter that matches everything is as useless as one that matches
    // nothing, and harder to notice.
    const comp = build([altoK10({ variantFuels: ['Petrol'] } as Partial<Car>)]);
    comp.selectedFuel.set('CNG');

    expect(comp.newCarModels().length).toBe(0);
  });

  it('still matches a model that has no trims entered yet', () => {
    // The row's own value stays in the set. Dropping it would hide the models
    // whose trims nobody has entered — the opposite failure, and quieter.
    const comp = build([altoK10({ variantFuels: [], fuel: 'CNG' } as Partial<Car>)]);
    comp.selectedFuel.set('CNG');

    expect(comp.newCarModels().length).toBe(1);
  });

  it('matches a trim that names two fuels in one string', () => {
    // The admin Fuel field is free text and its placeholder reads
    // "Petrol, Petrol + CNG…", so this is a shape the product asks for.
    const comp = build([altoK10({ variantFuels: ['Petrol + CNG'] } as Partial<Car>)]);
    comp.selectedFuel.set('CNG');

    expect(comp.newCarModels().length).toBe(1);
  });

  it('survives an older API build that sends no variantFuels', () => {
    // Version skew: Vercel deploys in a minute and Render in several, so the
    // browser runs this code against the previous API for a while.
    const comp = build([altoK10({ variantFuels: undefined } as Partial<Car>)]);
    comp.selectedFuel.set('Petrol');

    expect(comp.newCarModels().length).toBe(1);
  });
});
