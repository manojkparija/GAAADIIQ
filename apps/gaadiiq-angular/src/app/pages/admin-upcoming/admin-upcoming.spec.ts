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
