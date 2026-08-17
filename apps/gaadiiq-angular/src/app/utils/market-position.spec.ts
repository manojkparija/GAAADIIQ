/**
 * The two buyer-facing judgements.
 *
 * Both decide what a buyer believes about a car they cannot see, so the cases
 * that matter are the ones where being wrong is expensive: calling an
 * overpriced car fair, or putting a confident-looking number on a car nobody
 * has any history for.
 */

import {
  MarketBand,
  bandFromHeuristic,
  marketPosition,
  vehicleScore,
} from './market-position';

const band = (low: number, mid: number, high: number): MarketBand =>
  ({ low, mid, high, confidence: 80, source: 'heuristic' });

describe('marketPosition', () => {
  it('calls a car at the mid "at market"', () => {
    const p = marketPosition(500000, band(450000, 500000, 550000));
    expect(p.status).toBe('at');
    expect(p.deltaPct).toBe(0);
    expect(p.gaugePct).toBe(50);
  });

  it('does not flip on a difference the estimate cannot resolve', () => {
    // The band is ±10% and confidence tops out at 82. Calling a 3% difference
    // "above market" claims a precision this engine does not have.
    expect(marketPosition(515000, band(450000, 500000, 550000)).status).toBe('at');
    expect(marketPosition(485000, band(450000, 500000, 550000)).status).toBe('at');
  });

  it('names the direction and the size of a real gap', () => {
    const over = marketPosition(600000, band(450000, 500000, 550000));
    expect(over.status).toBe('above');
    expect(over.deltaPct).toBe(20);
    expect(over.label).toBe('20% above market');

    const under = marketPosition(400000, band(450000, 500000, 550000));
    expect(under.status).toBe('below');
    expect(under.deltaPct).toBe(-20);
    expect(under.label).toBe('20% below market');
  });

  it('tells a buyer what to do about it, not just what it is', () => {
    // A verdict with no next step leaves the buyer where they started.
    expect(marketPosition(400000, band(450000, 500000, 550000)).detail)
      .toContain('service history');
    expect(marketPosition(600000, band(450000, 500000, 550000)).detail)
      .toContain('Ask the seller');
  });

  it('keeps the gauge on the dial for a price outside the band', () => {
    // A car at twice the estimate must not render a needle off the end.
    expect(marketPosition(2000000, band(450000, 500000, 550000)).gaugePct).toBe(100);
    expect(marketPosition(1, band(450000, 500000, 550000)).gaugePct).toBe(0);
  });

  it('does not divide by a zero band', () => {
    const p = marketPosition(500000, band(0, 0, 0));
    expect(p.deltaPct).toBe(0);
    expect(p.gaugePct).toBe(50);
    expect(Number.isFinite(p.gaugePct)).toBe(true);
  });

  it('reads the band off the same engine the valuation page uses', () => {
    // Two pages disagreeing about the same car is worse than either being off.
    const b = bandFromHeuristic({
      make: 'Maruti Suzuki', model: 'Swift', variant: 'VXi',
      year: 2020, km: 45000, fuel: 'Petrol', transmission: 'Manual',
      owners: '1st Owner', condition: 'Good',
    });
    expect(b.mid).toBeGreaterThan(0);
    expect(b.low).toBeLessThan(b.mid);
    expect(b.high).toBeGreaterThan(b.mid);
    expect(b.source).toBe('heuristic');
  });
});

describe('vehicleScore', () => {
  const thisYear = new Date().getFullYear();

  it('scores a nearly new, single-owner car highly', () => {
    const s = vehicleScore({ year: thisYear - 1, km: 12000, owners: '1st Owner', condition: 'Excellent' });
    expect(s.score).toBeGreaterThanOrEqual(85);
    expect(s.grade).toBe('Excellent');
  });

  it('does not call a tired car excellent', () => {
    const s = vehicleScore({ year: thisYear - 12, km: 240000, owners: '4th Owner', condition: 'Fair' });
    expect(s.score).toBeLessThan(55);
    expect(s.grade).toBe('Needs inspection');
  });

  it('judges distance against the car\'s age, not a flat number', () => {
    // 60,000 km on a two-year-old car and on an eight-year-old one are not the
    // same car, and a flat threshold would score them identically.
    const young = vehicleScore({ year: thisYear - 2, km: 60000, owners: '1st Owner', condition: 'Good' });
    const old = vehicleScore({ year: thisYear - 8, km: 60000, owners: '1st Owner', condition: 'Good' });
    const kmOf = (s: ReturnType<typeof vehicleScore>) =>
      s.factors.find(f => f.label === 'Distance driven')!.score;
    expect(kmOf(young)).toBeLessThan(kmOf(old));
  });

  it('always says what it could not see', () => {
    // The brief asked for a score over accident history and service records.
    // Neither exists in this codebase, so the number must carry that with it —
    // a buyer reading 88/100 would otherwise assume a history report behind it.
    const s = vehicleScore({ year: thisYear - 3, km: 40000, owners: '1st Owner', condition: 'Good' });
    expect(s.missingFactors).toContain('Accident history');
    expect(s.missingFactors).toContain('Service records');
  });

  it('shows every factor it did use, with the reading behind it', () => {
    const s = vehicleScore({ year: thisYear - 4, km: 70000, owners: '2nd Owner', condition: 'Good' });
    expect(s.factors.map(f => f.label)).toEqual([
      'Age', 'Distance driven', 'Ownership', 'Seller-stated condition',
    ]);
    for (const f of s.factors) {
      expect(f.detail.length).withContext(`${f.label} has no reading`).toBeGreaterThan(0);
      expect(f.score).toBeGreaterThanOrEqual(0);
      expect(f.score).toBeLessThanOrEqual(100);
    }
  });

  it('prints the condition as a word, not as the stored enum label', () => {
    // The listing stores "good"; a buyer should not be shown a database value.
    const s = vehicleScore({ year: thisYear - 3, km: 40000, condition: 'good' });
    expect(s.factors.find(f => f.label === 'Seller-stated condition')!.detail).toBe('Good');
  });

  it('says so when the seller left ownership or condition blank', () => {
    // Silently scoring an unstated field as if it were stated is the quiet
    // version of making it up.
    const s = vehicleScore({ year: thisYear - 3, km: 40000 });
    expect(s.factors.find(f => f.label === 'Ownership')!.detail).toContain('Not stated');
    expect(s.factors.find(f => f.label === 'Seller-stated condition')!.detail).toContain('Not stated');
  });

  it('stays in range for absurd inputs', () => {
    const s = vehicleScore({ year: thisYear - 40, km: 990000, owners: '9th Owner', condition: 'Poor' });
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
    for (const f of s.factors) expect(f.score).toBeGreaterThanOrEqual(0);
  });

  it('treats a brand-new car as age 0 rather than a negative', () => {
    const s = vehicleScore({ year: thisYear + 1, km: 0, owners: '1st Owner', condition: 'Excellent' });
    expect(s.factors.find(f => f.label === 'Age')!.score).toBe(100);
    expect(s.score).toBeLessThanOrEqual(100);
  });
});
