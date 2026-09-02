import { computeOnRoadPrice } from './on-road-price';

/**
 * The on-road price is what a buyer budgets against, so an error here is money
 * rather than presentation.
 *
 * GST was once added to the ex-showroom price, which already contains it: an
 * ex-showroom figure is the ex-factory price plus GST and cess plus the
 * dealer's margin. A ₹5,25,000 S-Presso was therefore taxed twice and quoted
 * at ₹7.4L on the road — ₹1.5L more than it costs. The first test below is
 * that regression.
 *
 * The breakdown then reported GST as an indented "included" line rather than
 * adding it. That is gone too: it read as another charge, and keeping the slab
 * right meant knowing a car's length, which the catalogue does not record — a
 * sub-4m SUV was showing 40% where 18% applies. What this computes now is only
 * what a buyer pays ON TOP of the ex-showroom price.
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

  it('adds road tax, insurance and handling, which no published price includes', () => {
    const orp = spresso();

    expect(orp.registration).toBe(Math.round(525000 * 0.07));
    expect(orp.insurance).toBe(2094 + Math.round(525000 * 0.02));
    expect(orp.handling).toBe(10000);
  });

  it('charges an electric car half the state road tax', () => {
    // Most states levy half or nothing on an EV. This was asserted inside a
    // test that also checked the 5% GST line; that line is gone, this rule is
    // not, so it keeps a test of its own.
    const ev = computeOnRoadPrice(1500000, 'Electric', 'SUV', 0.08);
    const petrol = computeOnRoadPrice(1500000, 'Petrol', 'SUV', 0.08);

    expect(ev.registration).toBe(Math.round(1500000 * 0.04));
    expect(petrol.registration).toBe(Math.round(1500000 * 0.08));
    expect(ev.regRate).toBe(4);
  });

  it('reports no tax field a caller could put back on the total', () => {
    // The shape is the guard: with no gst/cess on the result, a template
    // cannot render a tax line and a sum cannot include one by accident.
    const orp = spresso() as unknown as Record<string, unknown>;

    expect('gst' in orp).toBeFalse();
    expect('gstRate' in orp).toBeFalse();
    expect('cess' in orp).toBeFalse();
  });

  it('follows the state road tax rate', () => {
    const cheap = computeOnRoadPrice(525000, 'Petrol', 'Hatchback', 0.05);
    const dear = computeOnRoadPrice(525000, 'Petrol', 'Hatchback', 0.12);

    expect(dear.total - cheap.total).toBe(Math.round(525000 * 0.07));
  });
});
