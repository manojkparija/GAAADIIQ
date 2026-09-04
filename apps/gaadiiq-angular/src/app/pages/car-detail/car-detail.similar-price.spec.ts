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

describe('car detail — which cars the similar table offers', () => {
  /**
   * Reported on the same Fronx page, a screenshot later: the table offered the
   * e Vitara at ₹16.0L and the Grand Vitara at ₹16.2L against a car that starts
   * at ₹6.84L, both drawn with the placeholder image, a dash for mileage and no
   * ratings.
   *
   * Three faults had to coincide. The tests below pin each separately, because
   * fixing one and calling it done is how two of them survived the first pass.
   */

  const stub = (over: Partial<any> = {}) => car({
    // What a catalogue row looks like before anyone has entered its trims: the
    // placeholder standing in for a photograph, no priced variants.
    image: 'assets/cars/placeholder.svg', images: [],
    variantCount: 0, variantPriceMin: undefined, variantPriceMax: undefined,
    ...over,
  });

  /**
   * mount() alone is not enough here. `car` is a plain field set from the route
   * subscription, which does not run in these tests, so similarCars() saw an
   * undefined subject and returned [] for every case — and the three exclusion
   * tests below passed against an empty list without exercising a single filter.
   * Caught by writing the inclusion cases: they failed identically.
   */
  function offered(cars: any[], subjectId = 'fronx'): string[] {
    const c = mount(cars, subjectId);
    c.car = cars.find(x => x.id === subjectId);
    return c.similarCars().map((s: any) => s.model);
  }

  it('no longer offers the ₹16L Vitaras against a ₹6.84L Fronx', () => {
    expect(offered([
      car(),
      stub({ id: 'ev', model: 'e Vitara', price: 1600000 }),
      stub({ id: 'gv', model: 'Grand Vitara', price: 1620000 }),
    ])).toEqual([]);
  });

  it('excludes a catalogue row with no photograph even when the price fits', () => {
    // isShowable() has existed for a while and four other screens call it.
    // This one did not, which is the whole of fault 1.
    expect(offered([
      car(),
      stub({ id: 'x', model: 'Nobody Photographed This', price: 700000,
             variantPriceMin: 700000, variantPriceMax: 800000 }),
    ])).toEqual([]);
  });

  it('still offers a private advert with no photograph', () => {
    // isShowable's deliberate exemption: an advert is a real car someone is
    // trying to sell, and hiding it removes them from the marketplace. Only a
    // catalogue row with no picture is merely an absence of data.
    expect(offered([
      car(),
      stub({ id: 'ad', model: 'Baleno', price: 700000, fromCatalogue: false,
             variantPriceMin: 700000, variantPriceMax: 800000 }),
    ])).toEqual(['Baleno']);
  });

  it('requires the body type to match, not merely the price', () => {
    // The old condition was `bodyType matches OR price is close`, so an SUV of
    // any price qualified. Both halves must now hold.
    expect(offered([
      car(),
      car({ id: 'h', model: 'Swift', bodyType: 'Hatchback',
            variantPriceMin: 700000, variantPriceMax: 900000 }),
    ])).toEqual([]);
  });

  it('keeps a genuine rival at a nearby entry price', () => {
    // The fix must not empty the table. An ₹8L SUV against a ₹6.84L one is
    // exactly what this feature is for.
    expect(offered([
      car(),
      car({ id: 'v', make: 'Tata', model: 'Nexon',
            variantPriceMin: 800000, variantPriceMax: 1400000 }),
    ])).toEqual(['Nexon']);
  });

  it('ranks on the entry price it displays, not the catalogue row figure', () => {
    // Fault 3: selection read car.price (₹9.3L for the Fronx) while the table
    // rendered startsAt() (₹6.84L), so the ordering was by closeness to a
    // number the page never showed. Nearer-to-₹6.84L must come first.
    expect(offered([
      car(),
      // Row price puts this one closest to ₹9.3L; entry price does not.
      car({ id: 'far', make: 'Hyundai', model: 'Creta', price: 930000,
            variantPriceMin: 1100000, variantPriceMax: 1600000 }),
      car({ id: 'near', make: 'Tata', model: 'Punch', price: 1500000,
            variantPriceMin: 700000, variantPriceMax: 950000 }),
    ])[0]).toBe('Punch');
  });

  it('follows the car when the route changes to a different one', () => {
    /**
     * This was a computed() reading `this.car`, a plain field. computed() tracks
     * signal reads only, so its memo was invalidated by carsData.cars() and
     * nothing else — and the catalogue is fetched once. Angular reuses this
     * component across route param changes, so viewing a second car left the
     * first car's rivals on screen.
     *
     * CLAUDE.md names this trap and says it has shipped twice. Every other test
     * here mounts a single car, which is exactly why none of them saw it.
     */
    const fronx = car();
    const alto = car({ id: 'alto', model: 'Alto', bodyType: 'Hatchback',
                       variantPriceMin: 400000, variantPriceMax: 500000 });
    const nexon = car({ id: 'nexon', make: 'Tata', model: 'Nexon',
                        variantPriceMin: 800000, variantPriceMax: 1400000 });
    const kwid = car({ id: 'kwid', make: 'Renault', model: 'Kwid', bodyType: 'Hatchback',
                       variantPriceMin: 480000, variantPriceMax: 600000 });

    const c = mount([fronx, alto, nexon, kwid], 'fronx');
    c.car = fronx;
    expect(c.similarCars().map((s: any) => s.model)).toEqual(['Nexon']);

    // Same component instance, new route param — the catalogue has not changed.
    c.car = alto;
    expect(c.similarCars().map((s: any) => s.model)).toEqual(['Kwid']);
  });

  it('does not narrow to nothing at the cheap end', () => {
    // The window is proportional, so without a floor a ₹4L car would admit
    // only ±₹1.4L. The floor is what keeps a real alternative from being
    // dropped over a small absolute difference.
    expect(offered([
      car({ id: 'cheap', model: 'Alto', variantPriceMin: 400000, variantPriceMax: 500000 }),
      car({ id: 'rival', make: 'Renault', model: 'Kwid',
            variantPriceMin: 480000, variantPriceMax: 600000 }),
    ], 'cheap')).toEqual(['Kwid']);
  });
});
