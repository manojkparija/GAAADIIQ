/**
 * One definition of "what does this car start at".
 *
 * Three screens have now been reported for the same wrong number, and each was
 * fixed on its own: the listings grid, the New Cars grid, and the similar-cars
 * table on the car detail page. Every one of them read `car.price` — the single
 * hand-maintained figure on the catalogue row — and captioned it "onwards".
 *
 * On the Fronx that figure is ₹9.3L while the published trims run ₹6.84L to
 * ₹11.98L. So the site quoted ₹9.3L "onwards" on one screen and
 * "₹6.84 – 11.98 Lakh" in the header of another, and the word "onwards"
 * promised that nothing was cheaper while ₹2.46L of the range sat below it.
 *
 * The fix that stops a fourth is one function, tested here, rather than three
 * identical corrections nobody can grep for.
 */
import { priceBand, startingPrice } from './cars-data.service';

/** The Fronx as the catalogue actually holds it. */
const FRONX = { price: 930000, variantPriceMin: 684000, variantPriceMax: 1198000 };

describe('startingPrice', () => {
  it('is the cheapest published trim', () => {
    expect(startingPrice(FRONX)).toBe(684000);
  });

  it('is never the catalogue row figure when trims are priced', () => {
    // The single assertion that would have caught all three reports.
    expect(startingPrice(FRONX)).not.toBe(930000);
  });

  it('falls back to the row for a model with no priced trims', () => {
    // That figure is the only price such a car has, so it is better than
    // nothing — the fallback is deliberate, not an oversight.
    expect(startingPrice({ price: 530000 })).toBe(530000);
  });

  it('does not treat a zero entry price as missing', () => {
    // `?? ` rather than `||`: a genuine 0 is a real answer, and `||` would
    // silently swap it for the row figure.
    expect(startingPrice({ price: 930000, variantPriceMin: 0 })).toBe(0);
  });

  it('never exceeds the top of the band', () => {
    const [lo, hi] = priceBand(FRONX)!;
    expect(startingPrice(FRONX)).toBe(lo);
    expect(lo).toBeLessThanOrEqual(hi);
  });
});

describe('priceBand', () => {
  it('reports the published span', () => {
    expect(priceBand(FRONX)).toEqual([684000, 1198000]);
  });

  it('is null when the trims carry no prices', () => {
    // So a caller can tell "one price" apart from "a range that is a point",
    // and say "onwards" only where it is true.
    expect(priceBand({ price: 530000 })).toBeNull();
  });

  it('is null when only one end is known', () => {
    // A half-known band would render "₹6.84L – ₹0".
    expect(priceBand({ price: 930000, variantPriceMin: 684000 })).toBeNull();
    expect(priceBand({ price: 930000, variantPriceMax: 1198000 })).toBeNull();
  });
});
