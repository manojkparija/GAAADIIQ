/**
 * "Notify Me" asks for contact details and records a verified lead.
 *
 * WHAT IT USED TO DO
 *
 * toggleNotify added a key to a Set, wrote the Set to localStorage, and set
 * the message "We will notify you when this car launches." No request was
 * made. There was no record anywhere of who had asked, so nobody could be
 * notified — the button made a promise the system had no way to keep, and the
 * reader had every reason to believe it.
 *
 * REPORTED: "after clicking for contact not asking for details", with a
 * screenshot of the strip showing the button already reading "🔔 Notified".
 * That label was the clearest symptom: it recorded that the reader had
 * pressed a button, and nothing else.
 *
 * The localStorage set survives, demoted to what it always was — a note to
 * this browser so the label can read "Notified" on a later visit. It is now
 * written only AFTER the lead is recorded, so it cannot claim an enquiry that
 * does not exist.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { NewCarsComponent } from './new-cars.component';
import { CarsDataService } from '../../services/cars-data.service';
import { LeadService } from '../../services/lead.service';
import { CityService } from '../../services/city.service';
import { AuthService } from '../../services/auth.service';

const BAYON = { make: 'Hyundai', model: 'Bayon' };

function mount() {
  const leads = {
    sendOtp: jasmine.createSpy('sendOtp').and.resolveTo(undefined),
    submit: jasmine.createSpy('submit').and.resolveTo({
      received: true, city: 'Kolkata', dealers_in_city: 2,
    }),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [NewCarsComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { queryParams: {} } } },
      {
        provide: CarsDataService,
        useValue: { cars: signal([]), loading: signal(false), failedSources: signal([]) },
      },
      { provide: LeadService, useValue: leads },
      { provide: CityService, useValue: { selectedCity: signal('Kolkata') } },
      {
        provide: AuthService,
        useValue: { currentUser: () => ({ name: 'Manoj', email: 'm@test.com' }) },
      },
    ],
  });
  const c = TestBed.createComponent(NewCarsComponent).componentInstance as any;
  return { c, leads };
}

/** Fill the form the way a reader who has done everything right would. */
function fillIn(c: any): void {
  c.notifyForm.name = 'Manoj';
  c.notifyForm.phone = '9876543210';
  c.notifyForm.city = 'Kolkata';
  c.notifyForm.otp = '123456';
  c.notifyConsent = true;
  c.notifyOtpSent.set(true);
}

describe('NewCarsComponent — Notify Me asks for details', () => {
  it('opens a form instead of silently marking the car', () => {
    // THE REPORTED BUG: the click used to be the whole interaction.
    const { c, leads } = mount();

    c.openNotify(BAYON);

    expect(c.notifyCar()?.model).toBe('Bayon');
    expect(leads.submit).not.toHaveBeenCalled();
  });

  it('does not mark the car as notified just for opening the form', () => {
    const { c } = mount();

    c.openNotify(BAYON);

    expect(c.notifiedCars().has('Hyundai||Bayon')).toBe(false);
  });

  it('records the lead against the announced car', async () => {
    const { c, leads } = mount();
    c.openNotify(BAYON);
    fillIn(c);

    await c.submitNotify();

    const sent = leads.submit.calls.mostRecent().args[0];
    expect(sent.make).toBe('Hyundai');
    expect(sent.model).toBe('Bayon');
    expect(sent.source).toBe('upcoming');
    expect(sent.phone).toBe('+919876543210');
    expect(sent.consent).toBe(true);
  });

  it('sends no car_id, because an announced car has no catalogue row', async () => {
    const { c, leads } = mount();
    c.openNotify(BAYON);
    fillIn(c);

    await c.submitNotify();

    expect(leads.submit.calls.mostRecent().args[0].car_id).toBeNull();
  });

  it('marks the car notified only once the lead is recorded', async () => {
    // The old code set this first and unconditionally, so the label claimed
    // an enquiry that had never been made.
    const { c } = mount();
    c.openNotify(BAYON);
    fillIn(c);

    await c.submitNotify();

    expect(c.notifiedCars().has('Hyundai||Bayon')).toBe(true);
    expect(c.notifySent()).toBe(true);
  });

  it('does not mark it notified when the code is wrong', async () => {
    const { c, leads } = mount();
    c.openNotify(BAYON);
    fillIn(c);
    leads.submit.and.rejectWith({ status: 400 });

    await c.submitNotify();

    expect(c.notifiedCars().has('Hyundai||Bayon')).toBe(false);
    expect(c.notifyError().toLowerCase()).toContain('code');
  });

  it('will not submit before a code has been sent', async () => {
    const { c, leads } = mount();
    c.openNotify(BAYON);
    fillIn(c);
    c.notifyOtpSent.set(false);

    await c.submitNotify();

    expect(leads.submit).not.toHaveBeenCalled();
  });

  it('will not submit without consent', async () => {
    const { c, leads } = mount();
    c.openNotify(BAYON);
    fillIn(c);
    c.notifyConsent = false;

    await c.submitNotify();

    expect(leads.submit).not.toHaveBeenCalled();
    expect(c.notifyError()).toContain('contacted');
  });

  it('pre-fills what the site already knows', () => {
    // The navbar holds a city and the reader is signed in; asking again from
    // blank is a field that answers itself.
    const { c } = mount();

    c.openNotify(BAYON);

    expect(c.notifyForm.city).toBe('Kolkata');
    expect(c.notifyForm.name).toBe('Manoj');
    expect(c.notifyForm.email).toBe('m@test.com');
  });

  it('tells the reader when they have asked for too many codes', async () => {
    const { c, leads } = mount();
    c.openNotify(BAYON);
    c.notifyForm.phone = '9876543210';
    leads.sendOtp.and.rejectWith({ status: 429 });

    await c.sendNotifyOtp();

    expect(c.notifyError()).toContain('Too many');
    expect(c.notifyOtpSent()).toBe(false);
  });

  it('clears the local marker without pretending the lead is withdrawn', () => {
    // There is no "unsend" for an enquiry a dealer may already have called
    // about, so the wording says what actually happened.
    const { c, leads } = mount();
    c.notifiedCars.set(new Set(['Hyundai||Bayon']));

    c.openNotify(BAYON);

    expect(c.notifiedCars().has('Hyundai||Bayon')).toBe(false);
    expect(c.notifyMsg()).toContain('earlier request');
    expect(leads.submit).not.toHaveBeenCalled();
  });
});
