/**
 * Editing a trim that already has a price.
 *
 * Reported from UAT as "Could not save: TypeError: a.trim is not a function",
 * on the one screen prices are supposed to come from.
 *
 * The cause is a declaration that is not true. CarVariant types
 * ex_showroom_price as `string | null`, but the API types it Decimal and
 * Pydantic serialises that as a JSON number. startEdit copied the value
 * straight into a form whose fields are all strings, and the save called
 * .trim() on a number.
 *
 * The same shape as the uuid/bigint faults already in the backlog: the
 * TypeScript said one thing, the wire carried another, and nothing caught it
 * until a person clicked the button. So these push the wrong types in
 * deliberately rather than trusting the interface.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { AdminVariantsComponent } from './admin-variants.component';

describe('AdminVariantsComponent — editing a priced trim', () => {
  let c: any;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminVariantsComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    c = TestBed.createComponent(AdminVariantsComponent).componentInstance;
  });

  /** body() is private; the crash was in it, so reach it deliberately. */
  const body = () => (c as any).body();

  it('survives a price that arrives as a number', () => {
    // Exactly what the API sends: Decimal -> JSON number.
    c.startEdit({
      id: 'v1', name: 'Sigma', ex_showroom_price: 685000 as any,
      fuel_type: 'Petrol', transmission: 'Manual',
      engine_cc: 1197, seating_capacity: 5, mileage: '21.79 km/l', features: [],
    } as any);

    expect(() => body()).not.toThrow();
    expect(body()['ex_showroom_price']).toBe('685000');
  });

  it('keeps the numbers numeric in the request body', () => {
    c.startEdit({
      id: 'v1', name: 'Sigma', ex_showroom_price: 685000 as any,
      engine_cc: 1197, seating_capacity: 5, features: [],
    } as any);

    expect(body()['engine_cc']).toBe(1197);
    expect(body()['seating_capacity']).toBe(5);
  });

  it('turns a missing value into null, never the word "null"', () => {
    // String(null) is "null", which would be stored as a trim's mileage.
    c.startEdit({ id: 'v1', name: 'Sigma', mileage: null, features: [] } as any);

    expect(body()['mileage']).toBeNull();
    expect(body()['fuel_type']).toBeNull();
  });

  it('splits the features box into a list', () => {
    c.startEdit({
      id: 'v1', name: 'Sigma',
      features: ['Dual Airbags', 'ABS with EBD'],
    } as any);

    expect(body()['features']).toEqual(['Dual Airbags', 'ABS with EBD']);
  });

  it('drops empty entries left by a trailing comma', () => {
    c.startEdit({ id: 'v1', name: 'Sigma', features: [] } as any);
    c.setField('features', 'Sunroof, , ABS,');

    expect(body()['features']).toEqual(['Sunroof', 'ABS']);
  });

  it('survives a features value that is somehow not a string', () => {
    c.startEdit({ id: 'v1', name: 'Sigma', features: [] } as any);
    (c.form as any).set({ ...c.form(), features: 42 as any });

    expect(() => body()).not.toThrow();
  });

  it('trims whitespace off the trim name', () => {
    c.startEdit({ id: 'v1', name: '  Alpha  ', features: [] } as any);
    expect(body()['name']).toBe('Alpha');
  });
});
