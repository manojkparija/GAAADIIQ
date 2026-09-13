/**
 * Compare puts two TRIMS side by side, not only two models.
 *
 * WHAT WAS ASKED FOR
 *
 * A screenshot of /compare, annotated: "Compare Car should be done for
 * variants — top variant with mid variant to see the difference (example)".
 *
 * The page could already hold the same car in two slots — neither the search
 * dropdown nor the popular picks ever excluded what was already chosen — but
 * doing so produced two identical columns, because every accessor took a Car
 * and both columns were the same Car object. There was nothing to differ on.
 *
 * So the column became a slot rather than a car: {slot, car, variant}.
 *
 * WHAT THIS FILE IS MOSTLY PROTECTING
 *
 * The untouched path. A buyer who never opens the variant picker must get the
 * table that was there before, to the rupee — and the way that is guaranteed
 * is that the entry accessors fall through to the car accessors the three
 * existing spec files already cover. Several tests below assert that
 * fallthrough directly, because the failure is silent: every figure would
 * still render, just wrong.
 *
 * The other quiet one is TCO_FUELS. A trim's fuel_type is free text on
 * purpose — "Petrol + CNG" is a real answer no enum holds — while TcoService
 * keys per-km, maintenance and depreciation off exact strings and falls back
 * to a flat default on anything else. Passing the trim's text straight through
 * would re-cost the car on a number that means "unrecognised", and the five
 * year block would move for no reason a reader could see.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { CompareComponent } from './compare.component';
import { CarsDataService } from '../../services/cars-data.service';

const PHOTO = 'https://cdn.gaadiiq.test/baleno/front.webp';

function car(over: Partial<any> = {}): any {
  return {
    id: 'baleno', make: 'Maruti Suzuki', model: 'Baleno', year: 2026,
    price: 900000, variantPriceMin: 665000, variantPriceMax: 995000,
    km: 0, fuel: 'Petrol', transmission: 'Manual',
    image: PHOTO, images: [PHOTO], rating: 4.3, reviews: 120, verified: true,
    bodyType: 'Hatchback', fromCatalogue: true, variantCount: 6,
    features: ['Dual Airbags'],
    specs: [{ label: 'Engine', value: '1197 cc' }],
    ...over,
  };
}

function trim(over: Partial<any> = {}): any {
  return {
    id: 'v-sigma', car_id: 'baleno', name: 'Sigma',
    ex_showroom_price: 665000, fuel_type: 'Petrol', transmission: 'Manual',
    engine_cc: 1197, seating_capacity: 5, mileage: '22.35 kmpl',
    features: ['Dual Airbags'], status: 'published', source: 'manual',
    sort_order: 0,
    ...over,
  };
}

const ALPHA = trim({
  id: 'v-alpha', name: 'Alpha', ex_showroom_price: 995000,
  transmission: 'AMT', mileage: '22.94 kmpl',
  features: ['Dual Airbags', '360 Camera', 'Sunroof'],
});

/**
 * A stub WITHOUT `variantsFor`, matching the three existing spec files.
 *
 * Kept deliberately: selectCar now reaches for that method, and calling one
 * that is not there would throw and take out tests that have nothing to do
 * with trims. The optional call in loadTrims is what this pins.
 */
function build(cars: any[], variants?: any[]) {
  TestBed.resetTestingModule();
  const stub: any = { cars: signal(cars), loading: signal(false), failedSources: signal([]) };
  if (variants) stub.variantsFor = () => Promise.resolve(variants);

  TestBed.configureTestingModule({
    imports: [CompareComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { queryParams: {} } } },
      { provide: CarsDataService, useValue: stub },
    ],
  });
  const c = TestBed.createComponent(CompareComponent).componentInstance as any;
  c.ngOnInit();
  return c;
}

/** Slot 0 and slot 1 both holding the same model, with trims loaded. */
async function twoTrims() {
  const c = build([car()], [trim(), ALPHA]);
  c.selectCar(0, car());
  c.selectCar(1, car());
  await Promise.resolve();
  await Promise.resolve();
  return c;
}

// ── the thing that was asked for ────────────────────────────────────────────

describe('CompareComponent — comparing two trims of one model', () => {
  it('offers the trims once a car is chosen', async () => {
    const c = await twoTrims();
    expect(c.trimOptions()[0].map((v: any) => v.name)).toEqual(['Sigma', 'Alpha']);
  });

  it('gives the two columns different prices', async () => {
    // THE REPORTED GAP. Before this, both columns read the model's starting
    // price and the comparison said nothing at all.
    const c = await twoTrims();
    c.setTrimById(0, 'v-sigma');
    c.setTrimById(1, 'v-alpha');

    const [mid, top] = c.activeEntries();
    expect(c.entryPrice(mid)).toBe(665000);
    expect(c.entryPrice(top)).toBe(995000);
  });

  it('names each column, so two columns of one model can be told apart', async () => {
    const c = await twoTrims();
    c.setTrimById(0, 'v-sigma');
    c.setTrimById(1, 'v-alpha');

    const [a, b] = c.activeEntries();
    expect(c.entryName(a)).toBe(c.entryName(b));       // same model, by design
    expect([c.entryTrimName(a), c.entryTrimName(b)]).toEqual(['Sigma', 'Alpha']);
  });

  it('awards the crown between the trims, not between the models', async () => {
    const c = await twoTrims();
    c.setTrimById(0, 'v-sigma');
    c.setTrimById(1, 'v-alpha');

    const [mid, top] = c.activeEntries();
    expect(c.isEntryWinner('price', mid, false)).withContext('Sigma is cheaper').toBeTrue();
    expect(c.isEntryWinner('price', top, false)).toBeFalse();
  });

  it('reads the trim’s own transmission and features', async () => {
    const c = await twoTrims();
    c.setTrimById(0, 'v-sigma');
    c.setTrimById(1, 'v-alpha');

    const [mid, top] = c.activeEntries();
    expect(c.entryTransmission(mid)).toBe('Manual');
    expect(c.entryTransmission(top)).toBe('AMT');
    expect(c.entryHasFeature(mid, 'Sunroof')).toBeFalse();
    expect(c.entryHasFeature(top, 'Sunroof')).toBeTrue();
  });

  it('prices the five-year cost from the trim', async () => {
    // Registration, insurance and resale are all percentages of the purchase
    // price, so this is most of what a buyer weighing two trims is looking at.
    const c = await twoTrims();
    c.setTrimById(0, 'v-sigma');
    c.setTrimById(1, 'v-alpha');

    const [mid, top] = c.activeEntries();
    expect(c.getEntryTco(mid).purchasePrice).toBe(665000);
    expect(c.getEntryTco(top).purchasePrice).toBe(995000);
    expect(c.getEntryTco(mid).netCost5yr).toBeLessThan(c.getEntryTco(top).netCost5yr);
  });

  it('fills the next free slot with the same car on request', async () => {
    const c = build([car()], [trim(), ALPHA]);
    c.selectCar(0, car());
    await Promise.resolve();
    await Promise.resolve();

    expect(c.canCompareTrims(0)).toBeTrue();
    c.compareTrims(0);

    expect(c.activeEntries().length).toBe(2);
    expect(c.selected()[1].model).toBe('Baleno');
  });
});

// ── what must not have changed ──────────────────────────────────────────────

describe('CompareComponent — the untouched path is unchanged', () => {
  it('quotes the starting price when no trim is chosen', async () => {
    const c = await twoTrims();
    const [a] = c.activeEntries();
    expect(c.entryPrice(a)).toBe(c.startsAt(car()));
    expect(c.entryPrice(a)).toBe(665000);
  });

  it('reads every other row exactly where it read it before', async () => {
    const c = await twoTrims();
    c.setTrimById(0, 'v-alpha');
    const [a] = c.activeEntries();

    // A trim has no year, odometer, rating or city. Redirecting any of these
    // at the variant would silently blank them.
    for (const key of ['year', 'km', 'rating', 'reviews']) {
      expect(c.getEntryVal(a, key)).withContext(key).toBe(c.getVal(car(), key));
    }
  });

  it('does not throw when the data service has no variantsFor', () => {
    // The stub the three existing compare specs provide. selectCar reaches for
    // that method now, and an unguarded call would break all of them.
    const c = build([car()]);
    expect(() => c.selectCar(0, car())).not.toThrow();
    expect(c.trimOptions()[0]).toEqual([]);
  });

  it('shows no variant picker for a car with no published trims', async () => {
    // A seller's advert is one car at one price. It gets the page it had.
    const c = build([car()], []);
    c.selectCar(0, car());
    await Promise.resolve();
    await Promise.resolve();
    expect(c.trimOptions()[0]).toEqual([]);
    expect(c.canCompareTrims(0)).toBeFalse();
  });

  it('keeps the trim-only rows hidden until a trim is chosen', async () => {
    const c = await twoTrims();
    expect(c.comparingTrims()).toBeFalse();

    c.setTrimById(0, 'v-alpha');
    expect(c.comparingTrims()).toBeTrue();
  });

  it('drops the trim when the slot’s car is replaced', async () => {
    const c = await twoTrims();
    c.setTrimById(0, 'v-alpha');

    c.selectCar(0, car({ id: 'swift', model: 'Swift' }));

    expect(c.trims()[0]).toBeNull();
  });

  it('drops the trim when the car is removed', async () => {
    const c = await twoTrims();
    c.setTrimById(0, 'v-alpha');

    c.removeCar(0);

    expect(c.trims()[0]).toBeNull();
    expect(c.trimOptions()[0]).toEqual([]);
  });
});

// ── the two silent ones ─────────────────────────────────────────────────────

describe('CompareComponent — figures that must not be invented', () => {
  it('does not render an unpriced trim as free', async () => {
    // ex_showroom_price is NULL until somebody prices that trim. Zero would
    // take every crown on the page and drag the five-year block with it.
    const c = build([car()], [trim({ id: 'v-new', name: 'Zeta', ex_showroom_price: null })]);
    c.selectCar(0, car());
    await Promise.resolve();
    await Promise.resolve();
    c.setTrimById(0, 'v-new');

    const [a] = c.activeEntries();
    expect(c.entryPrice(a)).toBe(665000);   // the model's starting price
    expect(c.entryPrice(a)).not.toBe(0);
  });

  it('does not re-cost the car on a fuel TcoService cannot price', async () => {
    // "Petrol + CNG" is a real trim fuel and no key in any of TcoService's
    // three tables. Passing it through would land on the flat defaults and
    // move maintenance, running cost and resale for no visible reason.
    const c = build([car()], [
      trim({ id: 'v-cng', name: 'Delta CNG', fuel_type: 'Petrol + CNG' }),
    ]);
    c.selectCar(0, car());
    await Promise.resolve();
    await Promise.resolve();
    c.setTrimById(0, 'v-cng');

    const [a] = c.activeEntries();
    const petrol = c.tco.calculateTco({ ...car(), price: 665000, fuel: 'Petrol' });
    expect(c.getEntryTco(a).maintenance5yr).toBe(petrol.maintenance5yr);
    expect(c.getEntryTco(a).fuel5yr).toBe(petrol.fuel5yr);

    // But the ROW still reports what the trim actually says. That is display,
    // not arithmetic, and hiding it would be its own kind of wrong.
    expect(c.entryFuel(a)).toBe('Petrol + CNG');
  });

  it('does use a trim fuel it CAN price', async () => {
    // The other half: a diesel trim of a petrol-listed model genuinely runs
    // and depreciates differently, and flattening that would be a new bug.
    const c = build([car()], [trim({ id: 'v-d', name: 'Zeta Diesel', fuel_type: 'Diesel' })]);
    c.selectCar(0, car());
    await Promise.resolve();
    await Promise.resolve();
    c.setTrimById(0, 'v-d');

    const [a] = c.activeEntries();
    const diesel = c.tco.calculateTco({ ...car(), price: 665000, fuel: 'Diesel' });
    expect(c.getEntryTco(a).fuel5yr).toBe(diesel.fuel5yr);
  });
});
