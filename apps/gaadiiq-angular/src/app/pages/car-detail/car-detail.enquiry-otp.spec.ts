/**
 * Contact Seller records a verified lead, not an unverified row.
 *
 * WHAT THIS REPLACED
 *
 * submitEnquiry wrote straight to Supabase from the browser:
 *
 *     this.sb.client.from('car_enquiries').insert({ buyer_phone, … })
 *
 * Four things followed. The phone number was whatever somebody typed, tied to
 * nobody. The API was bypassed, so phone_verified, consented_at and dealer
 * routing never ran. The row landed in `car_enquiries`, which the dealer inbox
 * — built on `car_leads` — does not read, so these enquiries were invisible to
 * the people meant to act on them. And its only protection was that table's
 * RLS policy.
 *
 * "Get Best Price", the button beside it, was fully verified through
 * POST /leads the whole time. The site had two enquiry paths and the
 * unverified one was on the button most buyers press.
 *
 * These assert the guards a buyer meets, and that nothing reaches the server
 * until they are satisfied — because the old failure mode was a submit that
 * always "worked".
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

import { CarDetailComponent } from './car-detail.component';
import { CarsDataService } from '../../services/cars-data.service';
import { LeadService } from '../../services/lead.service';
import { CityService } from '../../services/city.service';

const PHOTO = 'https://cdn.gaadiiq.test/fronx.webp';

function car(over: Partial<any> = {}): any {
  return {
    id: 'fronx-2026', make: 'Maruti Suzuki', model: 'Fronx', year: 2026,
    price: 751000, km: 0, fuel: 'Petrol', transmission: 'Manual',
    badge: '', badgeType: '', image: PHOTO, images: [PHOTO],
    rating: 0, reviews: 0, verified: true, bodyType: 'SUV',
    isSellerListing: false, fromCatalogue: true, variantCount: 14,
    ...over,
  };
}

function mount(over: Partial<any> = {}) {
  const leads = {
    sendOtp: jasmine.createSpy('sendOtp').and.resolveTo(undefined),
    submit: jasmine.createSpy('submit').and.resolveTo({
      received: true, city: 'Kolkata', dealers_in_city: 3,
    }),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CarDetailComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(convertToParamMap({ id: 'fronx-2026' })),
          snapshot: {
            paramMap: convertToParamMap({ id: 'fronx-2026' }),
            queryParamMap: convertToParamMap({}),
          },
          queryParams: { subscribe: () => {} },
        },
      },
      {
        provide: CarsDataService,
        useValue: {
          cars: signal([car(over)]),
          loading: signal(false),
          getById: () => car(over),
          getAll: () => [car(over)],
          reload: async () => {},
          fullCar: async () => null,
          variantsFor: async () => [],
        },
      },
      { provide: LeadService, useValue: leads },
      { provide: CityService, useValue: { selectedCity: signal('Kolkata') } },
    ],
  });
  const c = TestBed.createComponent(CarDetailComponent).componentInstance as any;
  c.car = car(over);
  return { c, leads };
}

/** A form filled in the way a buyer who has done everything right would. */
function fillIn(c: any): void {
  c.enquiryForm.name = 'Manoj';
  c.enquiryForm.phone = '9876543210';
  c.enquiryForm.city = 'Kolkata';
  c.enquiryForm.otp = '123456';
  c.enquiryConsent = true;
  c.enquiryOtpSent.set(true);
}

describe('CarDetailComponent — the enquiry is verified before it is recorded', () => {
  it('sends the lead through the API, with the code', async () => {
    const { c, leads } = mount();
    fillIn(c);

    await c.submitEnquiry();

    expect(leads.submit).toHaveBeenCalled();
    const sent = leads.submit.calls.mostRecent().args[0];
    expect(sent.otp).toBe('123456');
    expect(sent.phone).toBe('+919876543210');
    expect(sent.consent).toBe(true);
  });

  it('says which screen the buyer was on', async () => {
    // The follow-up script differs: this buyer typed a question and expects
    // an answer, not a price quote.
    const { c, leads } = mount();
    fillIn(c);

    await c.submitEnquiry();

    expect(leads.submit.calls.mostRecent().args[0].source).toBe('car_detail');
  });

  it('carries the question the buyer typed', async () => {
    // The box predates this change. Routing the form to /leads without
    // carrying it would drop the one part written in their own words.
    const { c, leads } = mount();
    fillIn(c);
    c.enquiryForm.notes = 'Is it available in white?';

    await c.submitEnquiry();

    expect(leads.submit.calls.mostRecent().args[0].notes).toBe('Is it available in white?');
  });

  it('will not submit before a code has been sent', async () => {
    // THE OLD BEHAVIOUR: this used to reach the database.
    const { c, leads } = mount();
    fillIn(c);
    c.enquiryOtpSent.set(false);

    await c.submitEnquiry();

    expect(leads.submit).not.toHaveBeenCalled();
    expect(c.enquiryError()).toContain('code');
  });

  it('will not submit without consent', async () => {
    // A dealer ringing somebody who did not agree to be rung is the harm.
    const { c, leads } = mount();
    fillIn(c);
    c.enquiryConsent = false;

    await c.submitEnquiry();

    expect(leads.submit).not.toHaveBeenCalled();
    expect(c.enquiryError()).toContain('contacted');
  });

  it('will not submit without a city', async () => {
    // Required by the API, and it is what routes the enquiry to a dealer who
    // can actually reach this buyer.
    const { c, leads } = mount();
    fillIn(c);
    c.enquiryForm.city = '';

    await c.submitEnquiry();

    expect(leads.submit).not.toHaveBeenCalled();
    expect(c.enquiryError()).toContain('city');
  });

  it('refuses a number that is not an Indian mobile', async () => {
    const { c, leads } = mount();
    fillIn(c);
    c.enquiryForm.phone = '12345';

    await c.submitEnquiry();

    expect(leads.submit).not.toHaveBeenCalled();
  });

  it('does not offer to send a code to an impossible number', () => {
    const { c } = mount();
    c.enquiryForm.phone = '12345';

    expect(c.canSendEnquiryOtp()).toBe(false);
  });

  it('names a wrong code rather than saying "something went wrong"', async () => {
    // A buyer can act on this one: send a new code. Folding it into a generic
    // failure leaves them retyping a number that was never the problem.
    const { c, leads } = mount();
    fillIn(c);
    leads.submit.and.rejectWith({ status: 400 });

    await c.submitEnquiry();

    expect(c.enquiryError().toLowerCase()).toContain('code');
    expect(c.enquirySent()).toBe(false);
  });

  it('tells the reader when they have asked for too many codes', async () => {
    const { c, leads } = mount();
    c.enquiryForm.phone = '9876543210';
    leads.sendOtp.and.rejectWith({ status: 429 });

    await c.sendEnquiryOtp();

    expect(c.enquiryError()).toContain('Too many');
    expect(c.enquiryOtpSent()).toBe(false);
  });

  it('clears the form and the code once the enquiry is in', async () => {
    // Otherwise a second enquiry reuses a code that has been consumed, and
    // fails in a way the buyer cannot explain.
    const { c } = mount();
    fillIn(c);

    await c.submitEnquiry();

    expect(c.enquirySent()).toBe(true);
    expect(c.enquiryForm.otp).toBe('');
    expect(c.enquiryOtpSent()).toBe(false);
    expect(c.enquiryConsent).toBe(false);
  });

  it('sends no car_id for a seller listing', async () => {
    // A seller's own listing is not a catalogue row. CarLead allows a null
    // car_id deliberately, with make/model carrying the vehicle.
    const { c, leads } = mount({ fromCatalogue: false, isSellerListing: true });
    fillIn(c);

    await c.submitEnquiry();

    const sent = leads.submit.calls.mostRecent().args[0];
    expect(sent.car_id).toBeNull();
    expect(sent.make).toBe('Maruti Suzuki');
  });

  it('leaves the busy flag down after a failure', async () => {
    const { c, leads } = mount();
    fillIn(c);
    leads.submit.and.rejectWith({ status: 500 });

    await c.submitEnquiry();

    expect(c.enquirySubmitting()).toBe(false);
  });
});
