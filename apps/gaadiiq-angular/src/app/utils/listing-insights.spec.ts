/**
 * Turning a seller's four numbers into something they can act on.
 *
 * The failure mode this guards against is confident advice drawn from nothing:
 * telling someone their photographs are putting buyers off when four people
 * have seen the car sends them to reshoot it for no reason.
 */

import { MIN_VIEWS_FOR_INSIGHT, listingInsights } from './listing-insights';

const base = {
  title: '2020 Swift VXi',
  price: 550000,
  views: 100,
  bookings: 2,
  loanInquiries: 1,
};

describe('listingInsights', () => {
  it('says nothing conclusive about a listing nobody has seen', () => {
    const out = listingInsights({ ...base, views: 4, bookings: 0, loanInquiries: 0 });
    expect(out.length).toBe(1);
    expect(out[0].kind).toBe('watch');
    // The distinction that matters: not seen is not the same as not working.
    expect(out[0].message).toContain('has not been seen');
  });

  it('does not blame the seller for a quiet marketplace', () => {
    const out = listingInsights({ ...base, views: 3, bookings: 0, loanInquiries: 0 });
    const text = out.map(i => i.message).join(' ');
    expect(text).not.toMatch(/price|photograph/i);
  });

  it('raises the alarm when a well-seen car gets no enquiries at all', () => {
    const out = listingInsights({
      ...base, views: MIN_VIEWS_FOR_INSIGHT + 50, bookings: 0, loanInquiries: 0,
    });
    expect(out[0].kind).toBe('act');
    expect(out[0].message).toMatch(/price|photograph/i);
  });

  it('flags a poor conversion rate without calling it a failure', () => {
    const out = listingInsights({ ...base, views: 400, bookings: 1, loanInquiries: 0 });
    expect(out[0].kind).toBe('act');
    expect(out[0].evidence).toContain('views per enquiry');
  });

  it('says so when a listing is doing well', () => {
    // An analytics page that only ever criticises stops being read.
    const out = listingInsights({ ...base, views: 60, bookings: 3, loanInquiries: 2 });
    expect(out[0].kind).toBe('good');
  });

  it('always shows the reading behind the advice', () => {
    // "Consider lowering your price" with nothing behind it is just nagging.
    const out = listingInsights({ ...base, views: 300, bookings: 0, loanInquiries: 0 });
    for (const i of out) {
      expect(i.evidence.length).withContext(`no evidence for: ${i.message}`).toBeGreaterThan(0);
    }
  });

  it('only compares time on the market when there is something to compare to', () => {
    const withoutMedian = listingInsights({
      ...base, views: 200, bookings: 5, loanInquiries: 5, daysOnMarket: 300,
      medianDaysToSell: null,
    });
    expect(withoutMedian.some(i => i.message.includes('listed considerably longer')))
      .withContext('compared a listing age against a median that does not exist')
      .toBe(false);

    const withMedian = listingInsights({
      ...base, views: 200, bookings: 5, loanInquiries: 5, daysOnMarket: 300,
      medianDaysToSell: 40,
    });
    expect(withMedian.some(i => i.message.includes('listed considerably longer'))).toBe(true);
  });

  it('does not call a fresh listing slow', () => {
    const out = listingInsights({
      ...base, views: 200, bookings: 5, loanInquiries: 5, daysOnMarket: 10,
      medianDaysToSell: 40,
    });
    expect(out.some(i => i.message.includes('listed considerably longer'))).toBe(false);
  });
});
