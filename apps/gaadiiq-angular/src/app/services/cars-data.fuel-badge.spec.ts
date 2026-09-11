/**
 * A fuel badge is only shown when it is true of the whole model.
 *
 * WHAT WAS REPORTED
 *
 * "Grand Vitara is not a fully electric model, it should not be tagged as an
 * EV." The card carried an EV chip while the line directly beneath it read
 * "Electric / Petrol / CNG / Hybrid" — the badge and the fuels it sat above
 * contradicted each other on the same card, and the badge was the one a buyer
 * reads first.
 *
 * WHY IT HAPPENED
 *
 * A catalogue row is a MODEL and `fuel_type` on it is a single value. That is
 * fine for a model sold one way and false for one sold four ways. The Grand
 * Vitara row says `electric`, so the badge said EV about a car whose fourteen
 * published trims are mostly petrol.
 *
 * THE RULE
 *
 * `variant_fuels` is built from the trims actually published, so it is the
 * authority where it exists. One fuel across the trims earns that fuel's
 * badge; more than one earns none, because no single-fuel claim is true. The
 * row's `fuel_type` is the fallback only for a model with no priced trims,
 * which is the one case where it is the best evidence available.
 *
 * WHAT THIS DOES NOT DO
 *
 * Correct the data. A Grand Vitara trim recorded as Electric is still recorded
 * that way, and still shows in the fuel line and under an Electric filter.
 * Stated here so the limit is not mistaken for the fix having missed.
 */
import { catalogueFuelBadge } from './cars-data.service';

function apiCar(over: Partial<any> = {}): any {
  return {
    id: 'c1', make: 'Maruti Suzuki', model: 'Grand Vitara', variant: null,
    year: 2026, ex_showroom_price: '1619000.00', image_urls: [],
    fuel_type: 'petrol', transmission: 'manual', body_type: 'suv',
    ...over,
  };
}

const badgeFor = (over: Partial<any>) => catalogueFuelBadge(apiCar(over));

describe('catalogue fuel badge', () => {
  it('does not call a multi-fuel model an EV', () => {
    // THE REPORTED CARD. The row claims electric; the trims say otherwise, and
    // the trims are what the model actually is.
    expect(badgeFor({
      fuel_type: 'electric',
      variant_fuels: ['Electric', 'Petrol', 'CNG', 'Hybrid'],
    })).toBe('');
  });

  it('still badges a model whose every trim is electric', () => {
    // e Vitara is a real EV and must keep its chip — the fix has to remove a
    // false claim without removing the true ones.
    expect(badgeFor({ fuel_type: 'electric', variant_fuels: ['Electric'] })).toBe('EV');
  });

  it('badges hybrid and CNG on the same rule', () => {
    expect(badgeFor({ fuel_type: 'hybrid', variant_fuels: ['Hybrid'] })).toBe('Eco');
    expect(badgeFor({ fuel_type: 'cng', variant_fuels: ['CNG'] })).toBe('CNG');
  });

  it('drops a hybrid or CNG badge on a mixed model too', () => {
    // The same falsehood, and leaving two of the three wrong is how this class
    // of bug survives a fix.
    expect(badgeFor({ fuel_type: 'hybrid', variant_fuels: ['Hybrid', 'Petrol'] })).toBe('');
    expect(badgeFor({ fuel_type: 'cng', variant_fuels: ['CNG', 'Petrol'] })).toBe('');
  });

  it('ignores case and padding from the trim data', () => {
    // variant_fuels is assembled from free text an admin typed, so "Electric"
    // and "electric " are the same fuel and must not read as two.
    expect(badgeFor({ variant_fuels: ['Electric', ' electric '] })).toBe('EV');
  });

  it('falls back to the row when no trim is published', () => {
    // A newly added model has no priced trims, and then fuel_type is the best
    // evidence there is. This is the path that used to run for everything.
    expect(badgeFor({ fuel_type: 'electric', variant_fuels: [] })).toBe('EV');
    expect(badgeFor({ fuel_type: 'electric' })).toBe('EV');
  });

  it('shows nothing for an ordinary petrol or diesel model', () => {
    // Unchanged behaviour, pinned so the rewrite cannot start inventing chips.
    expect(badgeFor({ fuel_type: 'petrol', variant_fuels: ['Petrol'] })).toBe('');
    expect(badgeFor({ fuel_type: 'diesel', variant_fuels: ['Diesel'] })).toBe('');
    expect(badgeFor({ fuel_type: null })).toBe('');
  });
});
