/**
 * The Overview tiles describe the whole model, not one row of it.
 *
 * WHAT WAS REPORTED
 *
 * The Maruti Suzuki Victoris page, Overview tab:
 *
 *     Fuel      Petrol
 *     Gearbox   Manual
 *
 * with its own Variants tab, two clicks away, listing CNG and Strong Hybrid
 * trims and AMT alongside Manual — nineteen variants in total.
 *
 * `cars.fuel_type` and `cars.transmission` hold ONE value each. They describe
 * the catalogue row, and a model sold in three fuels has no single true answer
 * to put in them. The tile stated one anyway, and a buyer reading it would
 * conclude the Victoris is not sold in CNG.
 *
 * WHAT THESE TESTS PIN
 *
 * That the spread comes from the published trims — and, mostly, that a model
 * genuinely sold in one fuel reads EXACTLY as it did before. That second half
 * is the half that can break silently: every one of these tiles would still
 * render, just saying something else.
 *
 * The fallback matters for the same reason. A model with no priced trims has
 * nothing to summarise, and the catalogue row is then the best answer
 * available rather than a wrong one.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { CarDetailComponent } from './car-detail.component';
import { CarsDataService } from '../../services/cars-data.service';

function trim(over: Partial<any> = {}): any {
  return {
    id: `v-${Math.random()}`, car_id: 'victoris', name: 'VXI',
    ex_showroom_price: 1050000, fuel_type: 'Petrol', transmission: 'Manual',
    engine_cc: 1462, seating_capacity: 5, mileage: '21.18 km/l',
    features: [], status: 'published', source: 'manual', sort_order: 0,
    ...over,
  };
}

function build() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CarDetailComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: { params: of({ id: 'victoris' }), queryParams: of({}), snapshot: { params: {}, queryParams: {} } },
      },
      {
        provide: CarsDataService,
        useValue: {
          cars: signal([]), loading: signal(false), failedSources: signal([]),
        },
      },
    ],
  });
  const c = TestBed.createComponent(CarDetailComponent).componentInstance as any;
  // The page's own car, as the catalogue holds it: ONE fuel, ONE gearbox.
  c.car = {
    id: 'victoris', make: 'Maruti Suzuki', model: 'Victoris', year: 2026,
    price: 1050000, km: 0, fuel: 'Petrol', transmission: 'Manual',
    image: '', images: [], rating: 0, reviews: 0, verified: true,
    bodyType: 'SUV', fromCatalogue: true,
  };
  return c;
}

describe('CarDetailComponent — the Overview tiles', () => {
  it('names every fuel the model is sold in', () => {
    // THE REPORTED BUG. Before this the tile read "Petrol" and stopped.
    const c = build();
    c.variants.set([
      trim({ fuel_type: 'Petrol' }),
      trim({ fuel_type: 'CNG', transmission: 'Manual' }),
      trim({ fuel_type: 'Strong Hybrid', transmission: 'AMT' }),
    ]);

    expect(c.fuelSummary()).toBe('Petrol · CNG · Strong Hybrid');
  });

  it('names every gearbox the model is sold with', () => {
    const c = build();
    c.variants.set([
      trim({ transmission: 'Manual' }),
      trim({ transmission: 'AMT' }),
    ]);

    expect(c.gearboxSummary()).toBe('AMT · Manual');  // gearboxOptions sorts
  });

  it('does not repeat a fuel that many trims share', () => {
    // Nineteen variants, three fuels. A tile listing Petrol nine times is
    // worse than the single value it replaced.
    const c = build();
    c.variants.set([
      trim({ fuel_type: 'Petrol' }),
      trim({ fuel_type: 'Petrol' }),
      trim({ fuel_type: 'CNG' }),
    ]);

    expect(c.fuelSummary()).toBe('Petrol · CNG');
  });

  it('reads exactly as before for a model sold in one fuel', () => {
    // THE ONE THAT MATTERS MOST. Most models are single-fuel, so this is what
    // nearly every page shows — and a change here would be invisible in
    // review and wrong on thousands of pages.
    const c = build();
    c.variants.set([
      trim({ fuel_type: 'Petrol', transmission: 'Manual' }),
      trim({ fuel_type: 'Petrol', transmission: 'Manual' }),
    ]);

    expect(c.fuelSummary()).toBe('Petrol');
    expect(c.gearboxSummary()).toBe('Manual');
  });

  it('falls back to the catalogue row when there are no trims', () => {
    // A model nobody has priced yet. The single value is then the best answer
    // available rather than a wrong one — and this is the pre-existing
    // behaviour for every such page.
    const c = build();
    c.variants.set([]);

    expect(c.fuelSummary()).toBe('Petrol');
    expect(c.gearboxSummary()).toBe('Manual');
  });

  it('ignores trims with no fuel recorded rather than printing a gap', () => {
    // fuel_type is nullable and free text. An empty one must not become
    // "Petrol · " or " · CNG".
    const c = build();
    c.variants.set([
      trim({ fuel_type: 'Petrol' }),
      trim({ fuel_type: null }),
      trim({ fuel_type: '  ' }),
      trim({ fuel_type: 'CNG' }),
    ]);

    expect(c.fuelSummary()).toBe('Petrol · CNG');
  });

  it('survives being called before the car is assigned', () => {
    // These are methods rather than computed()s precisely so they re-evaluate;
    // a computed over the plain `car` field would cache whatever it saw first.
    // Reading it during loading must not throw.
    const c = build();
    c.car = undefined;
    c.variants.set([]);

    expect(() => c.fuelSummary()).not.toThrow();
    expect(c.fuelSummary()).toBe('');
  });
});
