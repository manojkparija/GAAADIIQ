/**
 * The lead-capture modal.
 *
 * Two things here are worth a test rather than a read-through:
 *
 *  - the submit stays disabled until the buyer has actually consented, because
 *    the whole point of the record is that a dealer may ring them;
 *  - the flow never calls /auth/otp/verify. A correct code is consumed on
 *    verification, so calling it before submitting would leave nothing for the
 *    server to check and the lead would fail with "OTP not found". That is a
 *    coupling between two files which nothing in either file's types enforces,
 *    so it is asserted.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { OffersModalComponent } from './offers-modal.component';
import { CityService } from '../../services/city.service';
import { LeadService } from '../../services/lead.service';
import { environment } from '../../../environments/environment';

describe('offers modal', () => {
  let fixture: ComponentFixture<OffersModalComponent>;
  let comp: OffersModalComponent;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OffersModalComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CityService, useValue: { selectedCity: signal('Kolkata') } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OffersModalComponent);
    comp = fixture.componentInstance;
    comp.make = 'Maruti Suzuki';
    comp.model = 'Fronx';
    comp.carId = 'c-fronx';
    fixture.detectChanges();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('starts on the city step, prefilled from the navbar city', () => {
    // Asking again from blank would be a step that answers itself.
    expect(comp.step()).toBe('city');
    expect(comp.city).toBe('Kolkata');
  });

  it('will not advance without a city', () => {
    comp.city = '';
    expect(comp.canContinueCity()).toBeFalse();

    comp.goToPhone();
    expect(comp.step()).toBe('city');
  });

  describe('phone step', () => {
    beforeEach(() => {
      comp.goToPhone();
      fixture.detectChanges();
    });

    it('rejects a number that is not an Indian mobile', () => {
      comp.phoneRaw = '1234567890';        // does not start 6-9
      expect(comp.phoneE164()).toBeNull();
      expect(comp.canSendOtp()).toBeFalse();
    });

    it('normalises what the user types', () => {
      comp.phoneRaw = '98765 43210';
      expect(comp.phoneE164()).toBe('+919876543210');
    });

    it('sends the code to the OTP endpoint', async () => {
      comp.phoneRaw = '9876543210';
      const pending = comp.sendOtp();

      const req = http.expectOne(`${environment.apiUrl}/auth/otp/send`);
      expect(req.request.body).toEqual({ phone: '+919876543210' });
      req.flush({ message: 'OTP sent' });
      await pending;

      expect(comp.otpSent()).toBeTrue();
    });

    it('stays disabled until the buyer consents', async () => {
      comp.phoneRaw = '9876543210';
      const pending = comp.sendOtp();
      http.expectOne(`${environment.apiUrl}/auth/otp/send`).flush({});
      await pending;

      comp.otp = '123456';
      comp.consent = false;
      expect(comp.canSubmit())
        .withContext('submit must not be reachable without consent').toBeFalse();

      comp.consent = true;
      expect(comp.canSubmit()).toBeTrue();
    });

    it('submits the code with the lead and never calls /verify', async () => {
      comp.phoneRaw = '9876543210';
      const sending = comp.sendOtp();
      http.expectOne(`${environment.apiUrl}/auth/otp/send`).flush({});
      await sending;

      comp.otp = '123456';
      comp.consent = true;
      comp.locality = 'Salt Lake';
      const pending = comp.submit();

      // The coupling this spec exists for: verifying first would consume the
      // code and the lead would then be refused.
      http.expectNone(`${environment.apiUrl}/auth/otp/verify`);

      const req = http.expectOne(`${environment.apiUrl}/leads`);
      expect(req.request.body.otp).toBe('123456');
      expect(req.request.body.phone).toBe('+919876543210');
      expect(req.request.body.city).toBe('Kolkata');
      expect(req.request.body.consent).toBeTrue();
      expect(req.request.body.car_id).toBe('c-fronx');
      req.flush({ received: true, city: 'Kolkata', dealers_in_city: 3 });
      await pending;

      expect(comp.step()).toBe('done');
      expect(comp.dealersInCity()).toBe(3);
    });

    it('shows the server\'s reason when the code is wrong', async () => {
      comp.phoneRaw = '9876543210';
      const sending = comp.sendOtp();
      http.expectOne(`${environment.apiUrl}/auth/otp/send`).flush({});
      await sending;

      comp.otp = '000000';
      comp.consent = true;
      const pending = comp.submit();
      http.expectOne(`${environment.apiUrl}/leads`).flush(
        { detail: 'Invalid OTP. 4 attempt(s) remaining.' },
        { status: 401, statusText: 'Unauthorized' },
      );
      await pending;

      // The attempt count is useful to the person typing; a generic message
      // would throw it away.
      expect(comp.error()).toContain('4 attempt');
      expect(comp.step()).toBe('phone');
    });
  });
});
