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

/**
 * A refused save says why it was refused.
 *
 * OBSERVED IN THE PRODUCTION LOG, the deploy after the 409 shipped:
 *
 *   07:57:02  POST .../variants  409 Conflict
 *   07:57:38  POST .../variants  409 Conflict
 *   07:57:39  POST .../variants  409 Conflict
 *   07:57:40  POST .../variants  409 Conflict
 *   07:57:40  POST .../variants  409 Conflict
 *   07:57:42  POST .../variants  409 Conflict
 *
 * Six attempts, five of them inside four seconds. The API was answering
 * correctly every time — the `detail` on that 409 names the trim that already
 * exists and explains that the match ignores case and spacing. The screen
 * threw the body away and showed `Could not save: Error: HTTP 409`, so the
 * admin learned nothing from the first refusal and had no reason to stop.
 *
 * Replacing a 500 with a well-worded 409 achieves nothing if the well-worded
 * part is discarded one layer up. These assert the sentence reaches the
 * screen, because the status code already did.
 */
describe('AdminVariantsComponent — a refused save explains itself', () => {
  let c: any;
  const DETAIL =
    'This model already has a trim called "VXi (O) AGS | Metallic". Trim names '
    + 'are matched ignoring case and spacing, so edit the existing row rather '
    + 'than adding a second one.';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminVariantsComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    c = TestBed.createComponent(AdminVariantsComponent).componentInstance;
    c.selectedCarId.set('dc26c5a5-c64c-4401-af3e-d96d3fc7c7a2');
    c.startEdit({ id: 'v1', name: 'VXi (O) AGS | Metallic', features: [] } as any);
  });

  /** The 409 exactly as routers/cars.py::_duplicate_trim sends it. */
  function refuse(status: number, body: unknown) {
    spyOn(window, 'fetch').and.resolveTo({
      ok: false,
      status,
      statusText: 'Conflict',
      json: async () => body,
    } as any);
  }

  it('shows what the API said, not the status code', async () => {
    refuse(409, { detail: DETAIL });

    await c.save();

    expect(c.error()).toContain('already has a trim called');
    expect(c.error()).toContain('VXi (O) AGS | Metallic');
  });

  it('does not bury the message behind "Error:"', async () => {
    // String(err) on an Error prefixes "Error: ", which is machinery the
    // reader did not ask about and cannot act on.
    refuse(409, { detail: DETAIL });

    await c.save();

    expect(c.error()).not.toContain('Error:');
  });

  it('keeps the edit open so the name can be corrected', async () => {
    // cancelEdit is deliberately past the throw: a refused save that also
    // closed the form would make the admin retype the whole trim.
    refuse(409, { detail: DETAIL });

    await c.save();

    expect(c.editingId()).toBe('v1');
  });

  it('falls back to the status line when there is no detail to read', async () => {
    // A 502 from the platform never reaches the handler, so there is no
    // message to show and the status genuinely is all that is known.
    spyOn(window, 'fetch').and.resolveTo({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => { throw new Error('not JSON'); },
    } as any);

    await c.save();

    expect(c.error()).toContain('502');
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
