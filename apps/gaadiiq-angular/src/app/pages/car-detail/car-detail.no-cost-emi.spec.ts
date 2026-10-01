/**
 * The price panel does not offer finance nobody has agreed to.
 *
 * REPORTED with the Alto K10 open and the line circled: "why NO cost EMI it
 * should not be there".
 *
 * WHAT IT WAS
 *
 *     EMI from ₹{{ displayEmi() }}/mo · No cost EMI available
 *
 * The first half is computed. The second half was a string literal, appended
 * unconditionally to every car on the site. It was the only occurrence of the
 * phrase anywhere in the repository: no column, no API field, no lender, no
 * condition under which it was ever false. A reader has no way to tell the two
 * halves apart — they are one sentence in one muted line — so a claim with
 * nothing behind it borrowed the credibility of a figure that does.
 *
 * This is the same failure the house rule names for credit scores: a generated
 * number is indistinguishable from a real one at the point a buyer reads it,
 * and would be believed. "No cost EMI" is a finance offer, which makes it the
 * more expensive half of that pair to get wrong.
 *
 * So the claim goes and the computed figure stays. If no-cost EMI is ever
 * genuinely on offer, it needs a source to come from, and this test will say
 * so by failing.
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

const PHOTO = 'https://cdn.gaadiiq.test/alto.webp';

/** The car from the report. */
function alto(over: Partial<any> = {}): any {
  return {
    id: 'alto-k10', make: 'Maruti Suzuki', model: 'Alto K10', year: 2026,
    price: 370000, km: 0, fuel: 'Petrol', transmission: 'Manual',
    badge: '', badgeType: '', image: PHOTO, images: [PHOTO],
    rating: 0, reviews: 0, verified: true, bodyType: 'Hatchback',
    isSellerListing: false, fromCatalogue: true, variantCount: 2,
    ...over,
  };
}

const TRIMS = [
  {
    id: 'v-std', car_id: 'alto-k10', name: 'Alto K10 STD',
    ex_showroom_price: 370000, fuel_type: 'Petrol', transmission: 'Manual',
    status: 'published',
  },
  {
    id: 'v-vxi-amt', car_id: 'alto-k10', name: 'Alto K10 VXI AMT',
    ex_showroom_price: 545000, fuel_type: 'Petrol', transmission: 'Automatic',
    status: 'published',
  },
] as any[];

function mount(car: any = alto(), trims: any[] = TRIMS) {
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
          variantsFor: async () => trims,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(CarDetailComponent);
  const c = fixture.componentInstance as any;

  c.car = car;
  fixture.detectChanges();
  // After init: ngOnInit resolves the car afresh and clears what came before.
  c.car = car;
  c.variants.set(trims);
  fixture.detectChanges();
  return fixture;
}

function pageText(fixture: any): string {
  return (fixture.nativeElement.textContent ?? '').replace(/\s+/g, ' ');
}

describe('CarDetailComponent — no unbacked finance claim in the price panel', () => {
  it('does not say no-cost EMI is available', () => {
    // THE REPORTED LINE.
    const fixture = mount();

    expect(pageText(fixture)).not.toContain('No cost EMI');
  });

  it('says it for no car, whatever its price', () => {
    // It was unconditional, so one car proving it gone proves little. A
    // cheap car and an expensive one take different paths through
    // displayPrice(); neither may reintroduce the claim.
    for (const price of [370000, 5450000]) {
      const fixture = mount(alto({ price }), [
        { ...TRIMS[0], ex_showroom_price: price },
      ]);

      expect(pageText(fixture))
        .withContext(`reappeared at ₹${price}`)
        .not.toContain('No cost EMI');
    }
  });

  it('keeps the computed EMI figure, which is the half with a source', () => {
    // Removing the claim must not take the real number with it.
    const fixture = mount();

    expect(pageText(fixture)).toContain('EMI from ₹');
  });

  it('offers no cost-free finance under any wording', () => {
    // Deliberately broader than the one string: the fault was claiming a
    // lender's terms at all, not this phrasing of it.
    const text = pageText(mount()).toLowerCase();

    for (const claim of ['no cost emi', 'zero cost emi', 'interest free', '0% interest']) {
      expect(text).withContext(`page claims "${claim}"`).not.toContain(claim);
    }
  });
});
