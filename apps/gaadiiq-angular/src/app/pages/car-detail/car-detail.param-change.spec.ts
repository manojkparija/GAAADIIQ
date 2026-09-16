/**
 * Navigating from one car to another shows the other car.
 *
 * REPORTED, with a screenshot: on the Baleno's page, clicking "Maruti Suzuki
 * Swift" in the similar-cars table changed the address bar and went on
 * rendering the Baleno.
 *
 * WHY ONLY BETWEEN CARS
 *
 * Angular reuses a component instance when both URLs match the same route —
 * /cars/A to /cars/B is still `cars/:id` — so ngOnInit does not run again. It
 * read the id from `route.snapshot` exactly once, and resolveCar opens with
 * `if (this.carLoaded) return`, so the second navigation did nothing at all:
 * new address, old car.
 *
 * Arriving from the listings page, or opening a car's URL cold, builds the
 * component fresh and has always worked — which is every route anyone had
 * reason to test. The broken one is the link the site puts in front of a
 * buyer who is comparing two cars, which is the moment it matters most.
 *
 * These drive the paramMap directly rather than the router: a test that
 * navigated would exercise a fresh component and reproduce the working case.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute, convertToParamMap, ParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { CarDetailComponent } from './car-detail.component';
import { CarsDataService } from '../../services/cars-data.service';

const PHOTO = 'https://cdn.gaadiiq.test/x.webp';

function car(id: string, model: string, over: Partial<any> = {}): any {
  return {
    id, make: 'Maruti Suzuki', model, year: 2026,
    price: 610000, km: 0, fuel: 'Petrol', transmission: 'Manual',
    badge: '', badgeType: '', image: PHOTO, images: [PHOTO],
    rating: 0, reviews: 0, verified: true, bodyType: 'Hatchback',
    isSellerListing: false, fromCatalogue: true,
    variantCount: 10, variantPriceMin: 610000, variantPriceMax: 1009000,
    ...over,
  };
}

const BALENO = car('baleno-id', 'Baleno');
const SWIFT = car('swift-id', 'Swift', {
  price: 583900, variantPriceMin: 583900, variantPriceMax: 888900,
});

function mount() {
  const cars = [BALENO, SWIFT];
  const params = new BehaviorSubject<ParamMap>(convertToParamMap({ id: 'baleno-id' }));

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CarDetailComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: params,
          // The component also reads the snapshot; keep it in step.
          get snapshot() {
            return { paramMap: params.value, queryParamMap: convertToParamMap({}) };
          },
          queryParams: { subscribe: () => {} },
        },
      },
      {
        provide: CarsDataService,
        useValue: {
          cars: signal(cars),
          loading: signal(false),
          getById: (id: string) => cars.find(c => c.id === id),
          getAll: () => cars,
          reload: async () => {},
          fullCar: async () => null,
          variantsFor: async () => [],
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(CarDetailComponent);
  fixture.detectChanges();
  return { fixture, c: fixture.componentInstance as any, params };
}

describe('CarDetailComponent — navigating between cars', () => {
  it('renders the car in the URL, not the one before it', () => {
    // THE REPORTED BUG: this used to stay on the Baleno.
    const { fixture, c, params } = mount();
    expect(c.car.model).withContext('the fixture did not start on the Baleno').toBe('Baleno');

    params.next(convertToParamMap({ id: 'swift-id' }));
    fixture.detectChanges();

    expect(c.car.model).toBe('Swift');
  });

  it('shows the new car in the rendered page, not only in the field', () => {
    // The report was a screenshot, so at least one assertion should fail on
    // what a screenshot would show.
    const { fixture, params } = mount();

    params.next(convertToParamMap({ id: 'swift-id' }));
    fixture.detectChanges();

    // Scoped to the breadcrumb, not the whole page: the Swift's own
    // similar-cars table lists the Baleno, quite correctly, so asserting the
    // old name is absent anywhere fails on working behaviour.
    const crumb = (fixture.nativeElement as HTMLElement)
      .querySelector('.breadcrumb')!.textContent!;

    expect(crumb).toContain('Swift');
    expect(crumb)
      .withContext('the page is still titled with the car the reader left')
      .not.toContain('Baleno');
  });

  it('does not carry the previous car\'s trims across', () => {
    // Worse than a stale page: the old car's answers beside the new car's
    // name, with nothing to tell the reader which parts moved.
    const { fixture, c, params } = mount();
    c.variants.set([
      { id: 'v1', car_id: 'baleno-id', name: 'Alpha', ex_showroom_price: 1009000,
        fuel_type: 'Petrol', transmission: 'Manual', status: 'published' },
    ]);
    c.selectedVariantId.set('v1');

    params.next(convertToParamMap({ id: 'swift-id' }));
    fixture.detectChanges();

    expect(c.variants()).toEqual([]);
    expect(c.selectedVariantId()).toBeNull();
  });

  it('asks again whether the new car has a price', () => {
    // priceSettled describes one car. Carried over, the new car would claim
    // "Price not announced yet" using the previous car's answer.
    const { fixture, c, params } = mount();
    c.priceSettled.set(true);

    params.next(convertToParamMap({ id: 'swift-id' }));
    fixture.detectChanges();

    expect(c.priceSettled()).toBe(false);
  });

  it('does nothing when the same id is emitted again', () => {
    // Router emissions are not guaranteed to be distinct, and re-resolving on
    // every emission would restart the page under a reader who has not moved.
    const { fixture, c, params } = mount();
    c.variants.set([
      { id: 'v1', car_id: 'baleno-id', name: 'Alpha', ex_showroom_price: 1009000,
        fuel_type: 'Petrol', transmission: 'Manual', status: 'published' },
    ]);

    params.next(convertToParamMap({ id: 'baleno-id' }));
    fixture.detectChanges();

    expect(c.variants().length).withContext('the page reset itself for no reason').toBe(1);
  });
});
