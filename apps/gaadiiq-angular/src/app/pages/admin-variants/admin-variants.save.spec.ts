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

describe('AdminVariantsComponent — choosing a model and year', () => {
  let c: any;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminVariantsComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    c = TestBed.createComponent(AdminVariantsComponent).componentInstance;
    c.cars.set([
      { id: 'a', make: 'Maruti Suzuki', model: 'Fronx', year: 2026, ex_showroom_price: null },
      { id: 'b', make: 'Maruti Suzuki', model: 'Fronx', year: 2025, ex_showroom_price: null },
      { id: 'c', make: 'Maruti Suzuki', model: 'Fronx', year: 2024, ex_showroom_price: null },
      { id: 'd', make: 'Maruti Suzuki', model: 'Ertiga', year: 2021, ex_showroom_price: null },
      { id: 'e', make: 'Hyundai', model: 'Creta', year: 2025, ex_showroom_price: null },
    ]);
    c.selectedMake.set('Maruti Suzuki');
  });

  it('lists each model once, not once per year', () => {
    // Reported from UAT: "Fronx (2026)", "Fronx (2025)", "Fronx (2024)" read
    // as the same car added three times.
    expect(c.modelNameOptions().map((o: any) => o.label)).toEqual(['Ertiga', 'Fronx']);
  });

  it('keeps models of other makes out of the list', () => {
    expect(c.modelNameOptions().map((o: any) => o.label)).not.toContain('Creta');
  });

  it('offers the years that model exists for, newest first', () => {
    c.selectedModel.set('Fronx');
    expect(c.yearOptions().map((o: any) => o.label)).toEqual(['2026', '2025', '2024']);
  });

  it('carries the catalogue row id on the year, since variants hang off it', () => {
    c.selectedModel.set('Fronx');
    expect(c.yearOptions()[0].value).toBe('a');
  });

  it('selects the year outright when a model has only one', () => {
    // A list of one is a click that teaches nothing.
    c.onModelChange('Ertiga');
    expect(c.selectedCarId()).toBe('d');
  });

  it('waits for a choice when a model has several years', () => {
    c.onModelChange('Fronx');
    expect(c.selectedCarId()).toBe('');
  });

  it('clears the model and year when the make changes', () => {
    c.onModelChange('Ertiga');
    c.onMakeChange('Hyundai');
    expect(c.selectedModel()).toBe('');
    expect(c.selectedCarId()).toBe('');
  });
});
