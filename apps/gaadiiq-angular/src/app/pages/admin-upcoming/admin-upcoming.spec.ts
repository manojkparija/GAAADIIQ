/**
 * The Upcoming Cars admin screen.
 *
 * The strip on the New Cars page was a hardcoded array of five entries, with
 * the expected date as free text ("Q3 2026") and nothing that ever removed
 * one. Four of the five were on sale by the time it was reported, and
 * correcting that needed a deploy.
 *
 * Retired rows stay on this screen deliberately. A car marked "on sale" by
 * mistake is otherwise invisible to the person who has to undo it — the same
 * shape as the review queue's undo link landing on an empty tab.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { signal } from '@angular/core';

import { AdminUpcomingComponent } from './admin-upcoming.component';
import { UpcomingCarsService } from '../../services/upcoming-cars.service';
import { AuthService } from '../../services/auth.service';

function iso(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function car(over: Partial<any> = {}): any {
  return {
    id: over['id'] ?? 'u1', make: 'Tata', model: 'Sierra EV',
    expected_on: iso(120), expected_quarter: 'Q4 2026',
    expected_price_min: null, expected_price_max: null,
    body_type: 'SUV', fuel_type: 'Electric', image_url: null,
    launched_at: null, is_active: true,
    ...over,
  };
}

function mount(cars: any[]) {
  TestBed.resetTestingModule();
  const service = {
    cars: signal(cars),
    loading: signal(false),
    failed: signal(false),
    load: jasmine.createSpy('load').and.resolveTo(undefined),
    create: jasmine.createSpy('create').and.resolveTo(undefined),
    update: jasmine.createSpy('update').and.resolveTo(undefined),
    remove: jasmine.createSpy('remove').and.resolveTo(undefined),
  };
  TestBed.configureTestingModule({
    imports: [AdminUpcomingComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: UpcomingCarsService, useValue: service },
      { provide: AuthService, useValue: { isAdmin: () => true } },
    ],
  });
  const c = TestBed.createComponent(AdminUpcomingComponent).componentInstance as any;
  return { c, service };
}

describe('AdminUpcomingComponent', () => {
  it('shows an announced car as live', () => {
    const { c } = mount([car()]);

    expect(c.live().length).toBe(1);
    expect(c.retired().length).toBe(0);
  });

  it('treats a launched car as retired, not deleted', () => {
    const { c } = mount([car({ launched_at: '2026-08-01T00:00:00Z' })]);

    expect(c.live()).toEqual([]);
    expect(c.retired().length).toBe(1);
    expect(c.retiredReason(c.retired()[0])).toBe('On sale');
  });

  it('treats a passed date as retired', () => {
    const { c } = mount([car({ expected_on: iso(-1) })]);

    expect(c.live()).toEqual([]);
    expect(c.retiredReason(c.retired()[0])).toBe('Date passed');
  });

  it('keeps a car expected today on the live list', () => {
    // Matches the API's inclusive boundary. If the two disagreed, the admin
    // would see a car here that buyers cannot see, or the reverse.
    const { c } = mount([car({ expected_on: iso(0) })]);

    expect(c.live().length).toBe(1);
  });

  it('names a hidden car as hidden, not as on sale', () => {
    // An announcement that came to nothing is not a launch, and saying so
    // would be a claim nobody made.
    const { c } = mount([car({ is_active: false })]);

    expect(c.retiredReason(c.retired()[0])).toBe('Hidden');
  });

  it('asks the API for retired rows too', () => {
    const { service } = mount([]);

    expect(service.load).toHaveBeenCalledWith(true);
  });

  it('marks a car on sale rather than deleting it', () => {
    const { c, service } = mount([car()]);

    void c.markLaunched(car());

    expect(service.update).toHaveBeenCalledWith('u1', { launched: true });
    expect(service.remove).not.toHaveBeenCalled();
  });

  it('can undo a launch', () => {
    const { c, service } = mount([car({ launched_at: '2026-08-01T00:00:00Z' })]);

    void c.undoLaunched(car());

    expect(service.update).toHaveBeenCalledWith('u1', { launched: false });
  });

  it('sends a blank price as null, not as an empty string', () => {
    // "" would reach a NUMERIC column as a cast error; null is "not
    // announced", which is the common case.
    const { c, service } = mount([]);
    c.startAdd();
    c.setField('make', 'Tata');
    c.setField('model', 'Sierra EV');
    c.setField('expected_on', iso(90));

    void c.save();

    const body = service.create.calls.mostRecent().args[0];
    expect(body.expected_price_min).toBeNull();
    expect(body.body_type).toBeNull();
  });

  it('survives a price that arrives as a number', () => {
    // The variants editor crashed on exactly this: NUMERIC serialised as a
    // JSON number, copied into a form whose fields are strings.
    const { c } = mount([car({ expected_price_min: 2500000 })]);

    expect(() => c.startEdit(car({ expected_price_min: 2500000 }))).not.toThrow();
    expect(c.form().expected_price_min).toBe('2500000');
  });

  it('reports why a save failed, in the API words', () => {
    const { c, service } = mount([]);
    service.create.and.rejectWith(new Error('expected_on: field required'));
    c.startAdd();

    return c.save().then(() => {
      expect(c.error()).toContain('expected_on: field required');
    });
  });
});

/**
 * Typing a price does not crash the save.
 *
 * REPORTED, with a screenshot of the form filled in for a Hyundai Bayon —
 * "Could not save: TypeError: a.trim is not a function" — and a Render log
 * covering the same minutes with NO POST to /upcoming-cars in it. The crash
 * is in the browser, before the request; nothing was ever sent.
 *
 * `<input type="number">` bound with ngModel emits a NUMBER. So typing
 * 979000 into "Expected price from" puts 979000, not "979000", into a form
 * whose interface declares every field a string, and `money()` then called
 * .trim() on it.
 *
 * startEdit already coerced with String() for this exact reason — its
 * comment names the variants editor, which had the same fault. Loading a row
 * was fixed; typing into the form was not, and the declared type hid the
 * difference. So these push the wrong types in deliberately rather than
 * trusting the interface, as the variants tests do.
 */
describe('AdminUpcomingComponent — the form survives what the inputs emit', () => {
  /** The Bayon from the report, with the prices as the DOM supplies them. */
  function bayonForm(over: Record<string, unknown> = {}) {
    const { c, service } = mount([]);
    c.startAdd();
    c.form.set({
      make: 'Hyundai', model: 'Bayon', expected_on: '2026-10-12',
      // Numbers, not strings: this is what type="number" hands ngModel.
      expected_price_min: 979000, expected_price_max: 1549000,
      body_type: 'SUV', fuel_type: 'Petrol', image_url: '',
      ...over,
    });
    return { c, service };
  }

  it('does not throw when the price arrives as a number', () => {
    // THE REPORTED CRASH.
    const { c } = bayonForm();

    expect(() => (c as any).body()).not.toThrow();
  });

  it('sends the price as a number the API can store', async () => {
    const { c, service } = bayonForm();

    await c.save();

    expect(service.create).toHaveBeenCalled();
    const sent = service.create.calls.mostRecent().args[0];
    expect(sent['expected_price_min']).toBe(979000);
    expect(sent['expected_price_max']).toBe(1549000);
  });

  it('reports no error for a save that worked', async () => {
    // The screenshot's red banner is the whole symptom: the admin cannot
    // tell a rejected save from a crashed one.
    const { c } = bayonForm();

    await c.save();

    expect(c.error()).toBe('');
  });

  it('turns a blank price into null, never 0 or the word "null"', async () => {
    // "Leave blank if none was announced" — and a car with no announced price
    // is not a car priced at zero.
    const { c, service } = bayonForm({ expected_price_min: '', expected_price_max: '' });

    await c.save();

    const sent = service.create.calls.mostRecent().args[0];
    expect(sent['expected_price_min']).toBeNull();
    expect(sent['expected_price_max']).toBeNull();
  });

  it('turns a blank optional field into null, not an empty string', async () => {
    const { c, service } = bayonForm({ body_type: '', fuel_type: '', image_url: '' });

    await c.save();

    const sent = service.create.calls.mostRecent().args[0];
    expect(sent['body_type']).toBeNull();
    expect(sent['image_url']).toBeNull();
  });

  it('trims whitespace off the make and model', async () => {
    const { c, service } = bayonForm({ make: '  Hyundai  ', model: '  Bayon ' });

    await c.save();

    const sent = service.create.calls.mostRecent().args[0];
    expect(sent['make']).toBe('Hyundai');
    expect(sent['model']).toBe('Bayon');
  });
});
