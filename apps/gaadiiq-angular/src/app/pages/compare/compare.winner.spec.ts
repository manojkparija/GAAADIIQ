/**
 * What the green shading and the crown on /compare are allowed to mean.
 *
 * REPORTED, with three new cars side by side and four rows shaded green in
 * EVERY column: "why color".
 *
 * TWO FAULTS, BOTH VISIBLE IN ONE SCREENSHOT
 *
 * 1. `mine === Math.max(...vals)` crowns every entry equal to the max, and when
 *    all values tie every entry is the max. Catalogue rows all carry year 2026,
 *    km 0, rating 0 and reviews 0, so any three new cars crowned four rows at
 *    once. Price was the only row that behaved, because its values actually
 *    differ — which is precisely what made the others look wrong next to it.
 *
 *    A crown on `0 ★` is worse than noise: it says having no ratings is the
 *    thing to want.
 *
 * 2. `String(v) || '—'`. `String(undefined)` is the five-character string
 *    "undefined", which is truthy, so the fallback never ran and Owners and
 *    City printed the word `undefined`. The em-dash was written and had never
 *    been reached.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

import { CompareComponent } from './compare.component';
import { CarsDataService } from '../../services/cars-data.service';

function car(over: Partial<any> = {}): any {
  return {
    id: 'c1', make: 'Maruti Suzuki', model: 'Swift', year: 2026,
    price: 530000, km: 0, fuel: 'Petrol', transmission: 'Manual',
    badge: '', badgeType: '', image: null, images: [],
    rating: 0, reviews: 0, verified: true, bodyType: 'Hatchback',
    isSellerListing: false, fromCatalogue: true, variantCount: 1,
    ...over,
  };
}

function mount(cars: any[]) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CompareComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(convertToParamMap({})), queryParams: of({}),
          snapshot: { paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) },
        },
      },
      {
        provide: CarsDataService,
        useValue: {
          cars: signal(cars), loading: signal(false), failedSources: signal([]),
          getById: () => cars[0], getAll: () => cars,
          reload: async () => {}, variantsFor: async () => [],
        },
      },
    ],
  });
  const c = TestBed.createComponent(CompareComponent).componentInstance as any;
  c.selected.set([cars[0] ?? null, cars[1] ?? null, cars[2] ?? null]);
  return c;
}

const row = (c: any, label: string) => c.specRows.find((r: any) => r.label === label);
const winners = (c: any, label: string) => {
  const r = row(c, label);
  return c.activeEntries().filter((e: any) => c.isEntryWinner(r.key, e, r.higher)).length;
};

describe('CompareComponent — the crown has to mean something', () => {
  it('crowns nobody when every car has the same value', () => {
    // THE REPORTED BUG, in its exact shape: three catalogue cars, identical
    // year / km / rating / reviews.
    const c = mount([
      car({ id: 'a', model: 'Alto', price: 530000 }),
      car({ id: 'b', model: 'Celerio', price: 610000 }),
      car({ id: 'c', model: 'S-Presso', price: 470000 }),
    ]);

    for (const label of ['Year', 'KM Driven', 'Rating', 'Reviews']) {
      expect(winners(c, label)).withContext(`${label} crowned someone`).toBe(0);
    }
  });

  it('still crowns the one row that genuinely differs', () => {
    // Price is the control. If the tie rule ever over-reaches, this catches it.
    const c = mount([
      car({ id: 'a', price: 530000 }),
      car({ id: 'b', price: 610000 }),
      car({ id: 'c', price: 470000 }),
    ]);

    expect(winners(c, 'Price')).toBe(1);
    const r = row(c, 'Price');
    const won = c.activeEntries().filter((e: any) => c.isEntryWinner(r.key, e, r.higher));
    expect(won[0].car.price).withContext('cheapest should win').toBe(470000);
  });

  it('crowns a real rating over cars that have none', () => {
    // The tie rule must not become "never crown a row containing a zero".
    const c = mount([
      car({ id: 'a', rating: 0 }),
      car({ id: 'b', rating: 0 }),
      car({ id: 'c', rating: 4.5 }),
    ]);

    expect(winners(c, 'Rating')).toBe(1);
  });

  it('crowns the lower value where lower is better', () => {
    const c = mount([
      car({ id: 'a', km: 45000 }),
      car({ id: 'b', km: 12000 }),
    ]);
    const r = row(c, 'KM Driven');
    const won = c.activeEntries().filter((e: any) => c.isEntryWinner(r.key, e, r.higher));

    expect(won.length).toBe(1);
    expect(won[0].car.km).toBe(12000);
  });

  it('does not let one unreadable cell remove the crown from the row', () => {
    // Math.max(NaN, 5) is NaN and compares false against everything, so a
    // single unparseable value used to silently un-crown a row with a winner.
    const c = mount([
      car({ id: 'a', price: 'on request' }),
      car({ id: 'b', price: 610000 }),
      car({ id: 'c', price: 470000 }),
    ]);

    expect(winners(c, 'Price')).toBe(1);
  });

  it('never crowns a row that cannot be ranked', () => {
    const c = mount([car({ id: 'a' }), car({ id: 'b', fuel: 'Diesel' })]);

    expect(winners(c, 'Fuel Type')).toBe(0);
    expect(winners(c, 'Transmission')).toBe(0);
  });
});

describe('CompareComponent — the same car cannot fill two columns', () => {
  it('drops a car already held by another slot', () => {
    // REPORTED: Hyundai Creta in columns 2 and 3, identical on every row. A car
    // compared against itself tells the reader nothing.
    const c = mount([
      car({ id: 'creta', make: 'Hyundai', model: 'Creta' }),
      car({ id: 'alto', model: 'Alto K10' }),
    ]);
    c.selected.set([c.carsData.cars()[0], null, null]);
    c.searchB.set('creta');

    expect(c.filtered(1).map((x: any) => x.id)).not.toContain('creta');
  });

  it('still offers that car to the slot already holding it', () => {
    // Otherwise re-picking in the same slot would make the current choice
    // vanish from its own list.
    const c = mount([car({ id: 'creta', make: 'Hyundai', model: 'Creta' })]);
    c.selected.set([c.carsData.cars()[0], null, null]);
    c.searchA.set('creta');

    expect(c.filtered(0).map((x: any) => x.id)).toContain('creta');
  });

  it('does NOT block "Compare its variants", which needs the duplicate', () => {
    // compareTrims() puts one model in two columns on purpose so two trims can
    // be read side by side. A guard inside selectCar would have deleted that
    // feature while looking like a bug fix — which is why the guard is in the
    // dropdown instead.
    const c = mount([car({ id: 'creta', make: 'Hyundai', model: 'Creta' })]);
    const creta = c.carsData.cars()[0];
    c.selected.set([creta, null, null]);
    c.trimOptions.set([[{ id: 't1' }, { id: 't2' }], [], []]);

    c.compareTrims(0);

    expect(c.selected()[1]?.id).toBe('creta');
  });
});

describe('CompareComponent — two rows for one model are tellable apart', () => {
  it('adds the field that differs when a model-year appears twice', () => {
    const list = [
      car({ id: 'p', make: 'Hyundai', model: 'Creta', fuel: 'Petrol' }),
      car({ id: 'd', make: 'Hyundai', model: 'Creta', fuel: 'Diesel' }),
    ];
    const c = mount(list);

    expect(c.optionLabel(list[0], list)).toBe('2026 Hyundai Creta · Petrol');
    expect(c.optionLabel(list[1], list)).toBe('2026 Hyundai Creta · Diesel');
  });

  it('leaves an unambiguous row exactly as it was', () => {
    // The common case must not grow noise.
    const list = [
      car({ id: 'a', make: 'Hyundai', model: 'Creta' }),
      car({ id: 'b', make: 'Maruti Suzuki', model: 'Swift' }),
    ];
    const c = mount(list);

    expect(c.optionLabel(list[0], list)).toBe('2026 Hyundai Creta');
  });

  it('says so when two rows really are identical', () => {
    // Printing the same line twice would present a data fault as two choices.
    const list = [
      car({ id: 'a', make: 'Hyundai', model: 'Creta' }),
      car({ id: 'b', make: 'Hyundai', model: 'Creta' }),
    ];
    const c = mount(list);

    expect(c.optionLabel(list[0], list)).toContain('same spec');
  });
});

describe('CompareComponent — a missing value reads as a dash', () => {
  it('prints — rather than the word "undefined"', () => {
    // String(undefined) is truthy, so `String(v) || '—'` printed "undefined".
    const c = mount([car({ id: 'a' }), car({ id: 'b' })]);

    for (const label of ['Owners', 'City']) {
      const out = row(c, label).format(undefined);
      expect(out).withContext(`${label} formatter`).toBe('—');
      expect(out).not.toContain('undefined');
    }
  });

  it('dashes null and empty string too, on every row', () => {
    const c = mount([car({ id: 'a' }), car({ id: 'b' })]);

    for (const r of c.specRows) {
      for (const empty of [null, undefined, '']) {
        expect(r.format(empty)).withContext(`${r.label} given ${String(empty)}`).toBe('—');
      }
    }
  });

  it('still formats a real value', () => {
    // The guard must not swallow legitimate zeroes: 0 km and 0 reviews are
    // facts about a new car, not missing data.
    const c = mount([car({ id: 'a' }), car({ id: 'b' })]);

    expect(row(c, 'KM Driven').format(0)).toBe('0 km');
    expect(row(c, 'Reviews').format(0)).toBe('0');
    expect(row(c, 'Rating').format(0)).toBe('0 ★');
    expect(row(c, 'Price').format(470000)).toBe('₹4.7L');
  });
});
