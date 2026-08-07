import { computeOnRoadPrice } from './on-road-price';

/**
 * The on-road price is what a buyer budgets against, so an error here is money
 * rather than presentation.
 *
 * GST and cess were added to the ex-showroom price, which already contains
 * them: an ex-showroom figure is the ex-factory price plus GST, plus cess,
 * plus the dealer's margin. A ₹5,25,000 S-Presso was therefore taxed twice and
 * quoted at ₹7.4L on the road — ₹1.5L more than it costs.
 */
describe('computeOnRoadPrice', () => {
  // The car from the report: S-Presso VXI+ CNG, ₹5.25L, West Bengal at 7%.
  const spresso = () => computeOnRoadPrice(525000, 'Petrol', 'Hatchback', 0.07);

  it('does not charge GST and cess on top of the ex-showroom price', () => {
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
    // 28% of the taxable value, not 28% of the ex-showroom price.
    expect(orp.gst).toBeLessThan(Math.round(525000 * 0.28));
    expect(orp.gstRate).toBe(28);
    expect(orp.cessRate).toBe(1);
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

  it('puts a large SUV in the 22% cess band', () => {
    const suv = computeOnRoadPrice(2500000, 'Diesel', 'SUV', 0.1);
    expect(suv.cessRate).toBe(22);
  });
});
