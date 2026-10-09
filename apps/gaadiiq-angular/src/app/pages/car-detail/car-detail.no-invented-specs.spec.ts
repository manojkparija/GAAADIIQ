/**
 * The detail page states no specification it cannot source.
 *
 * REPORTED, with the panel circled: "why this information (top things to know
 * abt creta) is only available for creta — that too wrong, creta does not have
 * hybrid option."
 *
 * Both halves were right, and the second is the serious one. NEW_CAR_META
 * carried, for the Creta:
 *
 *     { title: 'Hybrid Option',
 *       caption: '48V mild hybrid powertrain available for better fuel
 *                 efficiency.' }
 *
 * The Creta sold in India has no such powertrain. That claim was not stale, it
 * was never true.
 *
 * WHY THE WHOLE SECTION WENT AND NOT THAT ONE LINE
 *
 * The other twenty-three highlights and eighteen "Latest Updates" are the same
 * kind of statement from the same place: specific, dated, checkable, and
 * attributable to nothing. "Creta crosses 10 lakh cumulative sales, 15 Feb
 * 2026." "Price hike of up to Rs. 7,000, 6 Jul 2026." Fixing only the line a
 * reader happened to catch would leave the rest wearing the authority of a
 * page that had just been corrected.
 *
 * The reader's first question is what settles it: six of 136 catalogue models
 * had this panel. The other 130 detail pages already shipped without it and
 * nobody missed them.
 *
 * This is the rule the component already states where displayPrice refuses to
 * print a price nobody entered — "the same rule the credit bureau service
 * follows, where fetch_score raises rather than returning a plausible figure".
 * A fabricated spec is not softer than a fabricated number: a buyer who reads
 * "hybrid available" and drives to a showroom was sent there by us.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

import { CarDetailComponent } from './car-detail.component';
import { CarsDataService } from '../../services/cars-data.service';

const PHOTO = 'https://cdn.gaadiiq.test/creta.webp';

/** The car from the report, as a new-car catalogue row. */
function creta(over: Partial<any> = {}): any {
  return {
    id: 'creta-2026', make: 'Hyundai', model: 'Creta', year: 2026,
    price: 1100000, km: 0, fuel: 'Petrol', transmission: 'Manual',
    badge: 'New', badgeType: 'new', image: PHOTO, images: [PHOTO],
    rating: 0, reviews: 0, verified: true, bodyType: 'SUV',
    isSellerListing: false, fromCatalogue: true, variantCount: 17,
    ...over,
  };
}

function mount(car: any = creta()) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CarDetailComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(convertToParamMap({ id: car.id })),
          snapshot: {
            paramMap: convertToParamMap({ id: car.id }),
            queryParamMap: convertToParamMap({}),
          },
          queryParams: { subscribe: () => {} },
        },
      },
      {
        provide: CarsDataService,
        useValue: {
          cars: signal([car]), loading: signal(false),
          getById: () => car, getAll: () => [car],
          reload: async () => {}, fullCar: async () => null,
          variantsFor: async () => [],
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(CarDetailComponent);
  const c = fixture.componentInstance as any;
  c.car = car;
  fixture.detectChanges();
  c.car = car;
  fixture.detectChanges();
  return fixture;
}

function pageText(fixture: any): string {
  return (fixture.nativeElement.textContent ?? '').replace(/\s+/g, ' ');
}

describe('CarDetailComponent — no specification the page cannot source', () => {
  it('does not claim the Creta has a hybrid option', () => {
    // THE REPORTED CLAIM, named so the regression is unmistakable.
    const text = pageText(mount());

    expect(text).not.toContain('Hybrid Option');
    expect(text).not.toContain('48V mild hybrid');
  });

  it('shows no "Top Things to Know" panel', () => {
    const text = pageText(mount());

    expect(text).not.toContain('Top Things to Know');
  });

  it('shows no "Latest Updates" panel', () => {
    // The dated news items — "crosses 10 lakh cumulative sales", "price hike
    // of up to Rs. 7,000" — read as reporting and were sourced from nothing.
    const text = pageText(mount());

    expect(text).not.toContain('Latest Updates');
    expect(text).not.toContain('cumulative sales');
  });

  it('shows neither panel for the other five models that had them', () => {
    // Asserting only the Creta would pass while the Swift still claimed a
    // "32.85 km/kg CNG" figure nobody can source.
    const others = [
      ['Maruti Suzuki', 'Swift'],
      ['Tata', 'Punch'],
      ['Tata', 'Nexon'],
      ['Kia', 'Seltos'],
      ['Mahindra', 'XUV700'],
    ];

    for (const [make, model] of others) {
      const text = pageText(mount(creta({ id: `${model}-x`, make, model })));
      expect(text)
        .withContext(`${make} ${model} still shows the highlights panel`)
        .not.toContain('Top Things to Know');
      expect(text)
        .withContext(`${make} ${model} still shows the updates panel`)
        .not.toContain('Latest Updates');
    }
  });

  it('still renders the page', () => {
    // The removal must take the panels and nothing else with them.
    const text = pageText(mount());

    expect(text).toContain('Creta');
  });
});
