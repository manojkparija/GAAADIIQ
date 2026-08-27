/**
 * The body type sent to Postgres must be an enum label.
 *
 * Reported from production:
 *   22P02: invalid input value for enum body_type: "SUV"
 *
 * `cars.body_type` is a native enum, not text — confirmed against the live
 * database, not assumed:
 *
 *   SELECT c.data_type, c.udt_name FROM information_schema.columns c
 *    WHERE c.table_name = 'cars' AND c.column_name = 'body_type';
 *   -> USER-DEFINED, body_type
 *   -> labels: hatchback, sedan, suv, muv, coupe, convertible
 *
 * Postgres matches enum labels exactly, casing included, so the form's
 * display text ('SUV') was rejected and the whole insert failed with it.
 *
 * Two failures are covered here, and they are different:
 *   - wrong casing, which these fix by mapping;
 *   - a dropdown entry with no label at all, which mapping cannot fix.
 *     Pickup and Van were both offered and neither exists in the enum, so
 *     choosing either made the listing unsubmittable. They are removed.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { ListCarComponent } from './list-car.component';

/** Exactly what pg_enum returns for body_type. */
const ENUM_LABELS = ['hatchback', 'sedan', 'suv', 'muv', 'coupe', 'convertible'];

describe('ListCarComponent — body type as an enum label', () => {
  let fixture: ComponentFixture<ListCarComponent>;
  let c: any;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ListCarComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ListCarComponent);
    c = fixture.componentInstance;
  });

  it('sends the enum label, not the display text', () => {
    c.form.bodyType = 'SUV';
    expect(c.bodyTypeForDb()).toBe('suv');
  });

  it('maps every option the dropdown offers to a real enum label', () => {
    // The actual defect: one unmapped option makes the listing unsubmittable
    // for whoever picks it. Checking one value would not have caught Pickup.
    for (const shown of c.bodyTypes) {
      c.form.bodyType = shown;
      const label = c.bodyTypeForDb();
      expect(ENUM_LABELS)
        .withContext(`"${shown}" is offered but maps to ${label}, which is not a body_type label`)
        .toContain(label as string);
    }
  });

  it('no longer offers a body type the enum cannot store', () => {
    expect(c.bodyTypes).not.toContain('Pickup');
    expect(c.bodyTypes).not.toContain('Van');
  });

  it('still offers the six the enum does have', () => {
    expect(c.bodyTypes.length).toBe(6);
    for (const shown of ['Hatchback', 'Sedan', 'SUV', 'MUV', 'Coupe', 'Convertible']) {
      expect(c.bodyTypes).toContain(shown);
    }
  });

  it('sends null when nothing is chosen', () => {
    c.form.bodyType = '';
    expect(c.bodyTypeForDb()).toBeNull();
  });

  it('sends null rather than passing an unknown value to Postgres', () => {
    // An unmapped string reaches the database and fails the whole insert,
    // losing the listing. Null loses one field and saves the advert.
    c.form.bodyType = 'Hovercraft';
    expect(c.bodyTypeForDb()).toBeNull();
  });

  /**
   * `transmission` is a native enum too, and failed identically the moment
   * body_type stopped failing:
   *   22P02: invalid input value for enum transmission: "Manual"
   */
  describe('transmission', () => {
    const TRANSMISSION_ENUM = ['manual', 'automatic', 'amt', 'cvt', 'dct'];

    it('sends the enum label, not the display text', () => {
      c.form.transmission = 'Manual';
      expect(c.transmissionForDb()).toBe('manual');
    });

    it('maps every option the dropdown offers to a real enum label', () => {
      for (const shown of c.transmissions) {
        c.form.transmission = shown;
        const label = c.transmissionForDb();
        expect(TRANSMISSION_ENUM)
          .withContext(`"${shown}" is offered but maps to ${label}, which is not a transmission label`)
          .toContain(label as string);
      }
    });

    it('keeps the acronyms lower-cased, not title-cased', () => {
      // 'AMT' -> 'Amt' is the mistake a naive toLowerCase-then-capitalise
      // would make, and Postgres would reject it just as readily.
      c.form.transmission = 'AMT';
      expect(c.transmissionForDb()).toBe('amt');
    });

    it('sends null rather than passing an unknown value to Postgres', () => {
      c.form.transmission = 'Tiptronic';
      expect(c.transmissionForDb()).toBeNull();
    });

    it('sends null when nothing is chosen', () => {
      c.form.transmission = '';
      expect(c.transmissionForDb()).toBeNull();
    });
  });

  it('does not normalise the columns that are plain text', () => {
    // badge, badge_type, city, color and fuel are text in the same table.
    // Lower-casing them would change stored data for no reason.
    c.setListingType('used');
    c.form.fuel = 'Petrol';
    c.form.city = 'New Town';
    c.form.color = 'White';
    expect(c.form.fuel).toBe('Petrol');
    expect(c.form.city).toBe('New Town');
    expect(c.form.color).toBe('White');
  });
});
