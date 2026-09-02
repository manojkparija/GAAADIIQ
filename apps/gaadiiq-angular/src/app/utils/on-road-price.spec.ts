import { computeOnRoadPrice } from './on-road-price';

/**
 * The on-road price is what a buyer budgets against, so an error here is money
 * rather than presentation.
 *
 * GST was added to the ex-showroom price, which already contains it: an
 * ex-showroom figure is the ex-factory price plus GST plus the dealer's
 * margin. A ₹5,25,000 S-Presso was therefore taxed twice and quoted at ₹7.4L
 * on the road — ₹1.5L more than it costs.
 *
 * The rates themselves were the pre-reform ones: a 28% slab plus a
 * compensation cess of 1% to 22%. The 56th GST Council meeting replaced that
 * from 22 September 2025 with 18% on small cars, 40% on everything larger, and
 * no cess at all — so the breakdown shown to a buyer no longer matched any
 * invoice they would be handed in a showroom.
 */
describe('computeOnRoadPrice', () => {
  // The car from the report: S-Presso VXI+ CNG, ₹5.25L, West Bengal at 7%.
  const spresso = () => computeOnRoadPrice(525000, 'Petrol', 'Hatchback', 0.07);

  it('does not charge GST on top of the ex-showroom price', () => {
    const orp = spresso();

    expect(orp.total).toBe(525000 + orp.registration + orp.insurance + orp.handling);
    // The specific number that was wrong, and the one that is right.
    expect(orp.total).toBe(584344);
    expect(orp.total).toBeLessThan(700000);
  });

  it('reports the tax that is inside the ex-showroom price', () => {
    const orp = spresso();

    // Recovered from the price, so ex-factory plus its taxes comes back to it.
    const exFactory = 525000 - orp.gst - orp.cess;
    expect(exFactory + orp.gst + orp.cess).toBe(525000);
    // A share of the taxable value, not of the ex-showroom price.
    expect(orp.gst).toBeLessThan(Math.round(525000 * 0.18));
    expect(orp.gstRate).toBe(18);
    // Compensation cess was abolished for cars; the line stays, the rate does not.
    expect(orp.cessRate).toBe(0);
    expect(orp.cess).toBe(0);
  });

  it('adds road tax, insurance and handling, which no published price includes', () => {
    const orp = spresso();

    expect(orp.registration).toBe(Math.round(525000 * 0.07));
    expect(orp.insurance).toBe(2094 + Math.round(525000 * 0.02));
    expect(orp.handling).toBe(10000);
  });

  it('charges an electric car 5% GST and half the road tax', () => {
    const ev = computeOnRoadPrice(1500000, 'Electric', 'SUV', 0.08);

    expect(ev.gstRate).toBe(5);
    expect(ev.cessRate).toBe(0);
    expect(ev.regRate).toBe(4);
    // Still not added on top, whatever the rate.
    expect(ev.total).toBe(1500000 + ev.registration + ev.insurance + ev.handling);
  });

  it('follows the state road tax rate', () => {
    const cheap = computeOnRoadPrice(525000, 'Petrol', 'Hatchback', 0.05);
    const dear = computeOnRoadPrice(525000, 'Petrol', 'Hatchback', 0.12);

    expect(dear.total - cheap.total).toBe(Math.round(525000 * 0.07));
  });

  it('charges a sub-4m SUV the small-car rate', () => {
    // This test used to assert the opposite — "an SUV is outside the small-car
    // definition by length and ground clearance whatever it costs". Ground
    // clearance belonged to the compensation cess the September 2025 reform
    // abolished; the 18% slab is fuel, engine capacity and a 4000mm length.
    //
    // A Fronx is 3995mm with a 1197cc petrol engine, so it is a small car in
    // the tax code however it is marketed — as are the Nexon, Venue, Brezza,
    // Punch, Exter, Magnite and Sonet. Every one of them was reading 40%.
    const fronx = computeOnRoadPrice(684000, 'Petrol', 'SUV', 0.11, 1197);

    expect(fronx.gstRate).toBe(18);
    expect(fronx.gst).toBe(Math.round((684000 / 1.18) * 0.18));
    expect(fronx.cessRate).toBe(0);
  });

  it('charges a large SUV the large-car rate', () => {
    const big = computeOnRoadPrice(2500000, 'Diesel', 'SUV', 0.1, 2184);

    expect(big.gstRate).toBe(40);
  });

  it('reads the diesel limit as 1500cc, not the petrol 1200', () => {
    // The slab is defined per fuel. A 1498cc diesel is small; the same
    // capacity in petrol is not.
    expect(computeOnRoadPrice(900000, 'Diesel', 'Hatchback', 0.1, 1498).gstRate).toBe(18);
    expect(computeOnRoadPrice(900000, 'Petrol', 'Hatchback', 0.1, 1498).gstRate).toBe(40);
  });

  it('falls back to the body-type guess when no engine is recorded', () => {
    // Capacity is the half of the legal test we have. Without it there is
    // nothing better than the old heuristic, and it stays.
    const suv = computeOnRoadPrice(800000, 'Petrol', 'SUV', 0.1);
    const hatch = computeOnRoadPrice(800000, 'Petrol', 'Hatchback', 0.1);

    expect(suv.gstRate).toBe(40);
    expect(hatch.gstRate).toBe(18);
  });

  it('keeps an EV at 5% whatever its engine field says', () => {
    expect(computeOnRoadPrice(1500000, 'Electric', 'SUV', 0.08, 0).gstRate).toBe(5);
  });

  it('does not let the slab move the on-road total', () => {
    // GST is inside the ex-showroom price, not added to it. Correcting the
    // rate must change the breakdown line and nothing a buyer pays.
    const asSmall = computeOnRoadPrice(684000, 'Petrol', 'SUV', 0.11, 1197);
    const asLarge = computeOnRoadPrice(684000, 'Petrol', 'SUV', 0.11, 2000);

    expect(asSmall.gstRate).not.toBe(asLarge.gstRate);
    expect(asSmall.total).toBe(asLarge.total);
  });

  it('charges a small hatchback the small-car rate', () => {
    const small = computeOnRoadPrice(600000, 'Petrol', 'Hatchback', 0.07);
    expect(small.gstRate).toBe(18);
  });

  it('charges a large saloon the large-car rate', () => {
    const large = computeOnRoadPrice(2200000, 'Petrol', 'Sedan', 0.1);
    expect(large.gstRate).toBe(40);
  });
});
