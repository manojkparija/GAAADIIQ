/**
 * Money against time.
 *
 * The risk here is the waiting time: "sells in about 12 days" is a promise,
 * and a platform with no completed sales has no business making it. A seller
 * who prices low on that promise and then waits six weeks does not come back.
 */

import { TestBed } from '@angular/core/testing';

import { PricingStrategyComponent } from './pricing-strategy.component';
import { DaysTurn } from '../../services/demand.service';

const band = { low: 450000, mid: 500000, high: 550000 };

const turn = (over: Partial<DaysTurn> = {}): DaysTurn => ({
  median_days: 30,
  sample_size: 42,
  has_enough_data: true,
  note: null,
  basis: 'observed',
  ...over,
});

describe('PricingStrategyComponent', () => {
  function make(daysTurn: DaysTurn | null = null) {
    const fixture = TestBed.createComponent(PricingStrategyComponent);
    fixture.componentInstance.band = band;
    fixture.componentInstance.daysTurn = daysTurn;
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => TestBed.configureTestingModule({ imports: [PricingStrategyComponent] }));

  it('offers a quick price below the middle and a patient one above it', () => {
    const [fast, profit] = make().componentInstance.strategies();
    expect(fast.price).toBeLessThan(band.mid);
    expect(profit.price).toBeGreaterThan(band.mid);
  });

  it('quotes no number of days until cars have actually sold here', () => {
    const c = make(null).componentInstance;
    expect(c.hasObservedTimings()).toBe(false);
    for (const s of c.strategies()) {
      expect(s.timing).withContext(`invented a timing: ${s.timing}`).not.toMatch(/\d+\s*days/);
    }
  });

  it('still ranks the two by speed without a measured median', () => {
    // The seller can be told which is faster without being told how long.
    const [fast, profit] = make(null).componentInstance.strategies();
    expect(fast.timing).toContain('Fastest');
    expect(profit.timing).toContain('longer');
  });

  it('uses the real median once the platform has one', () => {
    const c = make(turn({ median_days: 30, sample_size: 42 })).componentInstance;
    expect(c.hasObservedTimings()).toBe(true);
    expect(c.strategies()[0].timing).toMatch(/\d+ days/);
    expect(c.sampleSize()).toBe(42);
  });

  it('ignores a median the API says is not yet trustworthy', () => {
    // has_enough_data false means the number exists but the sample does not
    // support it. Reading median_days anyway defeats the whole threshold.
    const c = make(turn({ has_enough_data: false, median_days: 12 })).componentInstance;
    expect(c.hasObservedTimings()).toBe(false);
  });

  it('says on the card where the timings came from, or that there are none', () => {
    const withData = make(turn()).nativeElement.textContent;
    expect(withData).toContain('completed listings');

    const without = make(null).nativeElement.textContent;
    expect(without).toContain('cannot promise');
  });

  it('rounds to something a person would actually advertise', () => {
    // Nobody lists a car at ₹5,47,318.
    for (const s of make().componentInstance.strategies()) {
      expect(s.price % 1000).toBe(0);
    }
  });

  it('states the gap between the two, which is the actual decision', () => {
    const c = make().componentInstance;
    const [fast, profit] = c.strategies();
    expect(c.spread()).toBe(profit.price - fast.price);
    expect(c.spread()).toBeGreaterThan(0);
  });
});
