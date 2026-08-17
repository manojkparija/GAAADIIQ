/**
 * The valuation curve, and the three ways the old one was wrong.
 *
 * This engine tells a seller what their car is worth. It was doing so badly:
 * measured against three Swifts actually on sale in New Town, Kolkata in
 * August 2026, it valued them 20%, 55% and 36% below what a dealer three
 * kilometres away was asking. The three cars are pinned below as the closest
 * thing to real calibration data this project has.
 *
 * The tolerance is deliberately loose. Three cars of one model is a starting
 * point, not a calibration, and a test that demanded 2% accuracy would be
 * asserting a precision nobody has earned — it would fail the first time
 * somebody legitimately improved the curve against a wider sample.
 */

import { computeHeuristicValuation, ComputeParams } from './valuation-engine';

function value(over: Partial<ComputeParams>): ReturnType<typeof computeHeuristicValuation> {
  return computeHeuristicValuation({
    make: 'Maruti Suzuki', model: 'Swift', variant: 'VXi', year: 2020, km: 45000,
    fuel: 'Petrol', transmission: 'Manual', owners: '1st Owner', condition: 'Good',
    ...over,
  } as ComputeParams);
}

describe('valuation engine — the three defects', () => {
  it('never returns a negative price, however bad the car', () => {
    // The old model subtracted the kilometre and owner penalties OUTSIDE its
    // 75% cap, so they could total more than 100%. This exact car returned
    // MINUS ₹55,000.
    const r = value({
      year: 2012, km: 400000, owners: '4th Owner', condition: 'Needs Work',
    });
    expect(r.mid).toBeGreaterThan(0);
    expect(r.low).toBeGreaterThan(0);
  });

  it('keeps counting age past year eight', () => {
    // The old cap meant a 2006 and a 2018 Swift valued identically, because
    // depreciation stopped and only the trim was left to tell them apart.
    const years = [2018, 2014, 2010, 2006];
    const values = years.map(year => value({ year, km: 60000 }).mid);

    for (let i = 1; i < values.length; i++) {
      expect(values[i])
        .withContext(`${years[i]} is not worth less than ${years[i - 1]}`)
        .toBeLessThan(values[i - 1]);
    }
  });

  it('never values a newer car below an older one of the same model', () => {
    // The sharpest version of the same bug, and it was live: a 2018 Swift LXi
    // valued ₹25,000 BELOW a 2014 VXi, because past the cap the lower trim was
    // the only thing left that mattered.
    const newer = value({ year: 2018, variant: 'LXi', km: 29000 }).mid;
    const older = value({ year: 2014, variant: 'LXi', km: 33500 }).mid;
    expect(newer).toBeGreaterThan(older);
  });
});

describe('valuation engine — against the New Town market', () => {
  // Dealer asking prices, August 2026. The engine's `high` is the dealer
  // figure, so that is what these compare against.
  const OBSERVED = [
    { label: '2022 Swift VXi AMT', year: 2022, km: 21000, variant: 'VXi', transmission: 'Automatic', asking: 531000 },
    { label: '2018 Swift LXi',     year: 2018, km: 29000, variant: 'LXi', transmission: 'Manual',    asking: 359000 },
    { label: '2014 Swift VXi',     year: 2014, km: 33500, variant: 'VXi', transmission: 'Manual',    asking: 290000 },
  ];

  for (const car of OBSERVED) {
    it(`lands near the asking price for ${car.label}`, () => {
      const r = value(car);
      const errorPct = Math.abs((r.high - car.asking) / car.asking) * 100;
      expect(errorPct)
        .withContext(`${car.label}: asking ₹${car.asking}, engine ₹${r.high}`)
        .toBeLessThan(15);
    });
  }

  it('does not value a car at half what dealers ask for it', () => {
    // The failure that started this: every one of these was under by 20-55%.
    for (const car of OBSERVED) {
      expect(value(car).high).toBeGreaterThan(car.asking * 0.7);
    }
  });
});

describe('valuation engine — the three prices mean three different sales', () => {
  it('orders them quick sale, private sale, dealer forecourt', () => {
    const r = value({});
    expect(r.low).toBeLessThan(r.mid);
    expect(r.mid).toBeLessThan(r.high);
  });

  it('puts the headline below what a dealer would ask', () => {
    // A private seller has no warranty, no reconditioning and no showroom. A
    // headline quoting the forecourt price sets them up to list high and wait.
    const r = value({});
    expect(r.mid).toBeLessThan(r.high);
    expect(r.mid / r.high).toBeGreaterThan(0.75);
    expect(r.mid / r.high).toBeLessThan(0.95);
  });
});

describe('valuation engine — the adjustments still work', () => {
  it('marks down a car driven harder than its age accounts for', () => {
    const normal = value({ year: 2020, km: 90000 }).mid;
    const heavy = value({ year: 2020, km: 200000 }).mid;
    expect(heavy).toBeLessThan(normal);
  });

  it('does not mark down a car for ordinary use', () => {
    // 15,000 km a year is the norm, not a penalty.
    const expected = value({ year: 2020, km: 90000 }).mid;
    const low = value({ year: 2020, km: 30000 }).mid;
    expect(low).toBeGreaterThanOrEqual(expected);
  });

  it('marks down each additional owner', () => {
    const owners = ['1st Owner', '2nd Owner', '3rd Owner', '4th Owner'];
    const values = owners.map(o => value({ owners: o }).mid);
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThan(values[i - 1]);
    }
  });

  it('still reports how much value has been lost', () => {
    const r = value({ year: 2014 });
    expect(r.depreciation).toBeGreaterThan(0);
    expect(r.depreciation).toBeLessThan(100);
  });

  it('gives a brand-new car its full price', () => {
    const thisYear = new Date().getFullYear();
    const r = value({ year: thisYear, km: 0, condition: 'Excellent' });
    // Excellent condition adds 5%, so the dealer figure sits just above base.
    expect(r.high).toBeGreaterThan(700000);
  });
});
