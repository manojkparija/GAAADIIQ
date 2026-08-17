/**
 * The interest card.
 *
 * The brief calls this an urgency metric, and urgency is the one thing on a
 * car page that must never be manufactured. "3 people are viewing this now" on
 * a car nobody has opened is the oldest trick in online retail — and a buyer
 * who catches it once discounts everything else the page says.
 *
 * So these tests are mostly about what the card refuses to display.
 */

import { TestBed } from '@angular/core/testing';

import { ListingActivityComponent } from './listing-activity.component';
import { ListingActivity } from '../../services/demand.service';

function activity(over: Partial<ListingActivity> = {}): ListingActivity {
  return {
    views_24h: 0,
    views_7d: 0,
    unique_viewers_7d: 0,
    days_on_market: 3,
    has_enough_data: true,
    note: null,
    ...over,
  };
}

describe('ListingActivityComponent', () => {
  function render(a: ListingActivity) {
    const fixture = TestBed.createComponent(ListingActivityComponent);
    fixture.componentInstance.activity = a;
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => TestBed.configureTestingModule({ imports: [ListingActivityComponent] }));

  it('shows no number at all when the traffic is too thin to mean anything', () => {
    const el = render(activity({
      has_enough_data: false,
      views_24h: 2,
      note: 'Too few views so far to report activity for this car.',
    })).nativeElement;

    expect(el.querySelector('.la-stats')).withContext('reported traffic it cannot support').toBeNull();
    expect(el.textContent).toContain('Too few views');
  });

  it('never renders a zero as though it were a measurement', () => {
    // "0 views in 24 hours" reads as "nobody wants this car". What it actually
    // means is "this site is new", and the seller is not the one at fault.
    const el = render(activity({ has_enough_data: false, note: 'Too few views so far.' })).nativeElement;
    expect(el.textContent).not.toMatch(/0\s*views/);
  });

  it('reports views and people once there is enough', () => {
    const el = render(activity({
      has_enough_data: true, views_24h: 14, views_7d: 60, unique_viewers_7d: 22,
    })).nativeElement;

    expect(el.textContent).toContain('14');
    expect(el.textContent).toContain('22');
  });

  it('counts people separately from page loads', () => {
    // One buyer opening a car eight times is one interested buyer.
    const el = render(activity({
      has_enough_data: true, views_7d: 40, unique_viewers_7d: 5,
    })).nativeElement;
    const stats = el.querySelector('.la-stats').textContent;
    expect(stats).toContain('5');
    expect(stats).toContain('people this week');
  });

  it('always says how long the car has been listed, traffic or not', () => {
    // A fact that does not depend on traffic, and the more useful half: a car
    // that has sat for months tells a buyer something a view count cannot.
    const quiet = render(activity({ has_enough_data: false, note: 'x', days_on_market: 45 }));
    expect(quiet.nativeElement.textContent).toContain('Listed');
  });

  it('phrases the age in words a person would use', () => {
    const c = TestBed.createComponent(ListingActivityComponent).componentInstance;

    c.activity = activity({ days_on_market: 0 });
    expect(c.daysLabel()).toBe('Listed today');
    c.activity = activity({ days_on_market: 1 });
    expect(c.daysLabel()).toBe('Listed yesterday');
    c.activity = activity({ days_on_market: 12 });
    expect(c.daysLabel()).toBe('Listed 12 days ago');
    c.activity = activity({ days_on_market: 62 });
    expect(c.daysLabel()).toContain('2 months');
  });

  it('tells a buyer when a long-listed car may have room to negotiate', () => {
    const c = TestBed.createComponent(ListingActivityComponent).componentInstance;
    c.activity = activity({ days_on_market: 90 });
    expect(c.negotiationHint()).toContain('negotiate');

    c.activity = activity({ days_on_market: 10 });
    expect(c.negotiationHint()).withContext('a fresh listing is not a stale one').toBeNull();
  });
});
