/**
 * Compare puts two cars side by side on prices they are actually sold at.
 *
 * Found by sweeping for the bug reported on four other screens rather than
 * waiting for it to be reported on a fifth: every surface quoting `car.price`
 * as what a model costs. The Fronx row reads ₹9.3L against trims running
 * ₹6.84L to ₹11.98L.
 *
 * Compare is the worst place for it. The price is not only shown in three
 * places — the slot card, the search dropdown and the table header — it is a
 * compared row that awards a crown, and it is the base for the whole five-year
 * cost block, where registration, insurance and resale are percentages of it.
 * So one wrong figure declares a winner between two numbers neither car is
 * sold at, and then multiplies itself through seven more rows.
 *
 * An advert has no trims, so `startingPrice` returns its own price. That is
 * correct and is asserted below: a used car is one car at one price, and
 * quoting anything else for it would be a new bug.
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

const PHOTO = 'https://cdn.gaadiiq.test/fronx/front.webp';

function car(over: Partial<any> = {}): any {
  return {
    id: 'fronx', make: 'Maruti Suzuki', model: 'Fronx', year: 2026,
    price: 930000, variantPriceMin: 684000, variantPriceMax: 1198000,
    km: 0, fuel: 'Petrol', transmission: 'Manual',
    image: PHOTO, images: [PHOTO], rating: 0, reviews: 0, verified: true,
    bodyType: 'SUV', fromCatalogue: true, variantCount: 14,
    ...over,
  };
}

/** A seller's advert: one car, one price, no trims. */
function advert(over: Partial<any> = {}): any {
  return car({
    id: 'alto', make: 'Maruti Suzuki', model: 'Alto', year: 2019,
    price: 320000, variantPriceMin: undefined, variantPriceMax: undefined,
    km: 42000, fromCatalogue: false, isSellerListing: true, ...over,
  });
}

function build(cars: any[]) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CompareComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { queryParams: {} } } },
      {
        provide: CarsDataService,
        useValue: { cars: signal(cars), loading: signal(false), failedSources: signal([]) },
      },
    ],
  });
  const fixture = TestBed.createComponent(CompareComponent);
  const c = fixture.componentInstance as any;
  c.ngOnInit();
  cars.forEach((x, i) => c.selectCar(i, x));
  return c;
}

describe('Compare — the price each car is quoted at', () => {
  it('quotes the cheapest trim', () => {
    expect(build([car()]).startsAt(car())).toBe(684000);
  });

  it('does not quote the catalogue row figure', () => {
    expect(build([car()]).startsAt(car())).not.toBe(930000);
  });

  it('quotes an advert at its own price', () => {
    // No trims to start from, and none wanted: this is one specific car.
    expect(build([advert()]).startsAt(advert())).toBe(320000);
  });
});

describe('Compare — the Price row', () => {
  it('compares on the price it displays', () => {
    // getVal feeds both the cell and the crown, so they cannot disagree.
    expect(build([car()]).getVal(car(), 'price')).toBe(684000);
  });

  it('leaves other rows reading their own field', () => {
    const c = build([car()]);

    expect(c.getVal(car(), 'year')).toBe(2026);
    expect(c.getVal(car(), 'km')).toBe(0);
  });

  it('awards the crown to the genuinely cheaper car', () => {
    // The case the row figure gets backwards: a Fronx starting at ₹6.84L
    // against a Brezza starting at ₹8.0L. On the catalogue rows it is
    // ₹9.3L against ₹8.5L, so the crown went to the wrong car.
    const fronx = car();
    const brezza = car({
      id: 'brezza', model: 'Brezza', price: 850000,
      variantPriceMin: 800000, variantPriceMax: 1400000,
    });
    const c = build([fronx, brezza]);

    expect(c.isWinner('price', fronx, false)).withContext('Fronx is cheaper').toBeTrue();
    expect(c.isWinner('price', brezza, false)).toBeFalse();
  });
});

describe('Compare — the five-year cost block', () => {
  it('prices ownership from the trim the page quotes', () => {
    const c = build([car()]);

    expect(c.getTco(car()).purchasePrice).toBe(684000);
  });

  it('does not leave the row figure anywhere in the total', () => {
    // Registration, insurance and resale are percentages of the purchase
    // price, so the error would be multiplied rather than carried.
    const c = build([car()]);
    const onEntry = c.getTco(car()).netCost5yr;
    const onRow = c.getTco({ ...car(), variantPriceMin: undefined, variantPriceMax: undefined }).netCost5yr;

    expect(onEntry).toBeLessThan(onRow);
  });
});
