/**
 * A car with no published price does not get given one of ₹0.
 *
 * WHAT WAS REPORTED
 *
 * A car detail page showing "AI Price Analysis — Market Min ₹0, Market Max
 * ₹0", "AI Fair Value: ₹0", and an EMI of ₹0.
 *
 * WHAT IT ACTUALLY WAS — TWO FAULTS THAT LOOK LIKE ONE
 *
 * 1. `displayPrice()` fell through to `amount: this.car.price` with no guard.
 *    135 of the 136 catalogue rows carry no ex_showroom_price (see
 *    docs/ENGINEERING_BACKLOG.md), so those rendered a ₹0 headline, "EMI from
 *    ₹0/mo" beneath it, and — worse than either — an On-Road panel that added
 *    road tax and insurance to nothing and quoted the flat ₹10,000 handling
 *    charge as the on-road cost of the car. ₹0 reads as broken. ₹10,000 reads
 *    as true.
 *
 * 2. The AI Price Analysis card rendered for every car, whether or not one
 *    existed. `mapCatalogueCar` sets no `aiValuation` at all — correctly, since
 *    a catalogue row is manufacturer stock with a published price and no asking
 *    price to judge — and the template read `car.aiValuation?.marketMin || 0`.
 *    So the card drew an analysis of nothing: ₹0 to ₹0, an empty verdict badge,
 *    and "% confidence" with no number in front of it.
 *
 * THE RULE THIS ENCODES
 *
 * The same one `services/credit_bureau.py::fetch_score` follows, where it
 * raises rather than returning a plausible score: a figure the business does
 * not have must not be rendered as a figure it does. Absent is a state, and
 * saying so is cheaper than being believed.
 *
 * A third fault turned up while checking the first two, and is pinned below:
 * `confidence` was stored as 0.8 and rendered into "{{ confidence }}%", so
 * every listing that DID have a valuation advertised "0.8% confidence".
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute } from '@angular/router';
import { signal } from '@angular/core';

import { CarDetailComponent } from './car-detail.component';
import { CarsDataService } from '../../services/cars-data.service';

/** A catalogue car. `price` 0 is the reported state: no ex_showroom_price. */
function car(over: Partial<any> = {}): any {
  return {
    id: 'car-1', make: 'Maruti Suzuki', model: 'e Vitara', year: 2026,
    price: 0, km: 0, fuel: 'Electric', transmission: 'Automatic',
    image: '', images: [], specs: [], features: [],
    rating: 0, reviews: 0, verified: true, bodyType: 'SUV',
    isSellerListing: false,
    ...over,
  };
}

function fixture(c: any) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CarDetailComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: new Map([['id', c.id]]), queryParamMap: new Map() } },
      },
      {
        provide: CarsDataService,
        useValue: {
          cars: signal([c]),
          loading: signal(false),
          failedSources: signal([]),
          // detectChanges runs ngOnInit, which resolves the car for real.
          getById: (id: string) => (id === c.id ? c : null),
          getAll: () => [c],
          variantsFor: () => Promise.resolve([]),
          fullCar: () => Promise.resolve(null),
          reload: () => Promise.resolve(),
        },
      },
    ],
  });
  const f = TestBed.createComponent(CarDetailComponent);
  f.componentInstance.car = c;
  f.detectChanges();
  return f;
}

function build(c: any): CarDetailComponent {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CarDetailComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map(), queryParamMap: new Map() } } },
      {
        provide: CarsDataService,
        useValue: { cars: signal([c]), loading: signal(false), failedSources: signal([]) },
      },
    ],
  });
  const cmp = TestBed.createComponent(CarDetailComponent).componentInstance;
  cmp.car = c;
  return cmp;
}

describe('CarDetailComponent — a car with no published price', () => {
  it('reports no price rather than a price of zero', () => {
    const c = build(car());
    expect(c.displayPrice())
      .withContext('₹0 is not what this car costs; it is what we do not know')
      .toBeNull();
    expect(c.hasPrice()).toBeFalse();
  });

  it('quotes no EMI', () => {
    // "EMI from ₹0/mo" beside the headline, and a ₹0 monthly EMI in 2rem type
    // on the calculator card.
    const c = build(car());
    expect(c.displayEmi()).toBe(0);
    expect(c.financeableMax())
      .withContext('nothing to finance, so the card must not render')
      .toBe(0);
  });

  it('does not quote an on-road price built from nothing', () => {
    // The most dangerous of the three, because it looked real: road tax and
    // registration come to 0 on a base of 0, but handling is a flat ₹10,000,
    // so the panel confidently priced the car at about ten thousand rupees.
    const c = build(car());
    expect(c.onRoadPrice()).toBeNull();
  });

  it('does not present a cost of ownership that is all zeros', () => {
    const c = build(car());
    expect(c.ownershipCost()).toBeNull();
  });

  it('does not render a resale percentage of NaN', () => {
    // value / price with price 0 is 0/0. The panel showed a literal "NaN%".
    const c = build(car());
    expect(c.resaleValue()).toBeNull();
    expect(c.resaleCurve()).toEqual([]);
  });
});

describe('CarDetailComponent — a car that does have a price', () => {
  const PRICED = car({ price: 1_050_000 });

  it('still quotes the price, the EMI and the on-road total', () => {
    // The other half of every guard above: none of them may fire on a car
    // that has the figure. A guard that hid a real price would be a worse
    // bug than the one being fixed, and would look identical from the fix's
    // own tests if only the absent case were checked.
    const c = build(PRICED);

    expect(c.displayPrice()?.amount).toBe(1_050_000);
    expect(c.hasPrice()).toBeTrue();
    expect(c.displayEmi()).toBeGreaterThan(0);
    expect(c.financeableMax()).toBeGreaterThan(0);
    expect(c.onRoadPrice()?.total)
      .withContext('on-road is ex-showroom plus tax, insurance and handling')
      .toBeGreaterThan(1_050_000);
    expect(c.ownershipCost()?.total).toBeGreaterThan(0);
    expect(c.resaleValue()?.value).toBeGreaterThan(0);
  });

  it('finances the on-road price, not the ex-showroom figure', () => {
    // Pins the existing behaviour the guards run through, so "return null when
    // there is no price" cannot quietly become "return the catalogue price".
    const c = build(PRICED);
    expect(c.financeableMax()).toBe(Math.round(c.onRoadPrice()!.total));
  });
});


describe('CarDetailComponent — what the unpriced page actually renders', () => {
  // The computeds above are the mechanism; this is the symptom. The report was
  // a screenshot, so at least one test should fail on what a screenshot would
  // show — a guard that returned null while the template still printed ₹0
  // somewhere else would pass every test above it.
  //
  // Not verified in a real browser: the catalogue needs api.gaadiiq.com, which
  // this sandbox cannot reach, so /car/:id renders its outage state instead.
  // This is the closest measurement available here.

  it('prints no ₹0 anywhere, and says the price is not announced', () => {
    const text = (fixture(car()).nativeElement as HTMLElement).innerText;

    expect(text).withContext('the reported symptom').not.toContain('₹0');
    expect(text).not.toContain('NaN');
    expect(text).toContain('Price not announced yet');
  });

  it('does not draw an AI Price Analysis for a car that has no valuation', () => {
    // mapCatalogueCar sets no aiValuation, and this card used to render
    // regardless: "Market Min ₹0 / Market Max ₹0", an empty verdict badge and
    // "% confidence" with no number.
    const el = fixture(car()).nativeElement as HTMLElement;

    expect(el.querySelector('.ai-val-card'))
      .withContext('an analysis of nothing, drawn like a real one')
      .toBeNull();
    expect(el.querySelector('.emi-card'))
      .withContext('nothing to finance')
      .toBeNull();
  });

  it('still draws both cards for a car that has a price and a valuation', () => {
    const el = fixture(car({
      price: 1_050_000,
      aiValuation: { fairPrice: 1_000_000, marketMin: 950_000, marketMax: 1_050_000, verdict: 'Fair', confidence: 80 },
    })).nativeElement as HTMLElement;

    expect(el.querySelector('.ai-val-card')).not.toBeNull();
    expect(el.querySelector('.emi-card')).not.toBeNull();
    // The third fault: 0.8 rendered into a "%" slot read as 0.8% confidence.
    expect(el.innerText).toContain('80% confidence');
    expect(el.innerText).not.toContain('Price not announced');
  });
});
