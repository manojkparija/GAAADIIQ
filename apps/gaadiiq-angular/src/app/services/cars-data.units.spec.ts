/**
 * A battery is measured in kWh, not cc.
 *
 * WHAT THIS PREVENTS COMING BACK
 *
 * Reported with a screenshot of the e Vitara variants tab:
 *
 *     e Vitara Delta — Electric · Automatic · 49 cc · 440
 *
 * 49cc is a moped. The column is named `engine_cc` and three separate
 * renderers appended "cc" to it unconditionally, so on an electric car they
 * stamped a petrol unit onto a battery figure. The value is 49 **kWh** — and
 * the car's own description, two lines below on the same screen, read "Battery
 * Capacity: 49 kWh" while the summary line above it said cc.
 *
 * The storage is deliberately unchanged: one numeric column holds "how big is
 * the thing that moves this car" for whatever it burns or stores. What was
 * wrong was hardcoding the unit at the point of display, in three places, none
 * of which asked what kind of car it was.
 *
 * The last test is the one that keeps this honest. Only the electric case
 * infers a unit, because it is the only one where the meaning is unambiguous.
 * Guessing a unit for a petrol figure would turn a merely incomplete number
 * into a wrong one, which is a worse bug than the one being fixed.
 */
import {
  capacityLabel,
  capacitySpecLabel,
  economyLabel,
  isElectricFuel,
} from './cars-data.service';

describe('capacityLabel', () => {
  it('measures an electric car in kWh', () => {
    expect(capacityLabel(49, 'electric')).toBe('49 kWh');
  });

  it('still measures a combustion engine in cc', () => {
    expect(capacityLabel(1197, 'petrol')).toBe('1197 cc');
    expect(capacityLabel(2184, 'diesel')).toBe('2184 cc');
  });

  it('treats a hybrid as a combustion car, because it has an engine', () => {
    // A hybrid's engine_cc really is engine displacement — the battery is a
    // separate figure the catalogue does not carry in this column.
    expect(capacityLabel(1490, 'hybrid')).toBe('1490 cc');
  });

  it('says nothing at all when there is no figure', () => {
    // Rendering "null cc" is worse than rendering nothing.
    expect(capacityLabel(null, 'electric')).toBeNull();
    expect(capacityLabel(undefined, 'petrol')).toBeNull();
  });

  it('is not fooled by the case the API actually sends', () => {
    // The API sends lowercase "electric"; the UI carries "Electric".
    expect(capacityLabel(61, 'Electric')).toBe('61 kWh');
    expect(capacityLabel(61, ' ELECTRIC ')).toBe('61 kWh');
  });
});

describe('capacitySpecLabel', () => {
  it('calls the electric figure a battery and the other one an engine', () => {
    expect(capacitySpecLabel('electric')).toBe('Battery');
    expect(capacitySpecLabel('petrol')).toBe('Engine');
    expect(capacitySpecLabel(null)).toBe('Engine');
  });
});

describe('economyLabel', () => {
  it('gives a bare number on an electric car its unit', () => {
    // The "· 440" with nothing after it, from the same screenshot.
    expect(economyLabel('440', 'electric')).toBe('440 km range');
  });

  it('leaves a figure that already carries its unit alone', () => {
    expect(economyLabel('21.79 km/l', 'petrol')).toBe('21.79 km/l');
    expect(economyLabel('500 km', 'electric')).toBe('500 km');
  });

  it('does NOT invent a unit for a bare petrol figure', () => {
    // The test that keeps the inference honest. A bare number on a petrol car
    // could be kmpl or km per tank; there is no way to tell from here, and a
    // confidently wrong unit is worse than a missing one.
    expect(economyLabel('440', 'petrol')).toBe('440');
    expect(economyLabel('18', null)).toBe('18');
  });

  it('says nothing when there is no figure', () => {
    expect(economyLabel('', 'electric')).toBeNull();
    expect(economyLabel(null, 'electric')).toBeNull();
    expect(economyLabel('   ', 'petrol')).toBeNull();
  });
});

describe('isElectricFuel', () => {
  it('recognises the values the catalogue actually holds', () => {
    expect(isElectricFuel('electric')).toBeTrue();
    expect(isElectricFuel('Electric')).toBeTrue();
    expect(isElectricFuel('Electric (BEV)')).toBeTrue();
  });

  it('does not claim anything else is electric', () => {
    // "hybrid" is the one worth pinning: it contains a battery but is not a
    // battery-electric car, and treating it as one would relabel a real
    // engine displacement as kWh.
    for (const fuel of ['petrol', 'diesel', 'hybrid', 'cng', '', null, undefined]) {
      expect(isElectricFuel(fuel)).withContext(`fuel=${fuel}`).toBeFalse();
    }
  });
});
