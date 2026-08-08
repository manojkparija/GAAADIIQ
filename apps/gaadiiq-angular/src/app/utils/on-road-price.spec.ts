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

  it('charges an SUV the large-car rate whatever it costs', () => {
    // Outside the small-car definition by length and ground clearance, so an
    // inexpensive one is still a large car for GST.
    const dear = computeOnRoadPrice(2500000, 'Diesel', 'SUV', 0.1);
    const cheap = computeOnRoadPrice(800000, 'Petrol', 'SUV', 0.1);

    expect(dear.gstRate).toBe(40);
    expect(cheap.gstRate).toBe(40);
    expect(dear.cessRate).toBe(0);
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
