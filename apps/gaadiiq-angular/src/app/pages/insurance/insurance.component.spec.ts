import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { InsuranceComponent } from './insurance.component';
import { environment } from '../../../environments/environment';

/**
 * The insurance page.
 *
 * The first test is the one that matters and is the reason this file exists:
 * the page must not display a premium, an estimate or an IDV figure. The API
 * refuses to invent one; a number added here later would defeat that while
 * being much harder to notice, because it would look like ordinary page copy.
 */
describe('InsuranceComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InsuranceComponent, HttpClientTestingModule],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap({})) },
        },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows no rupee figure anywhere on the page', () => {
    const fixture = TestBed.createComponent(InsuranceComponent);
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent ?? '';

    // A rupee amount, in any of the forms this app writes them.
    expect(text).not.toMatch(/₹\s*[\d,]/);
    expect(text).not.toMatch(/\bRs\.?\s*[\d,]/);
    expect(text).not.toMatch(/\bINR\s*[\d,]/);
    // "₹5.4 lakh" style, without the symbol.
    expect(text).not.toMatch(/[\d.]+\s*(lakh|crore)/i);
  });

  it('states plainly that GAADIIQ is not the insurer', () => {
    const fixture = TestBed.createComponent(InsuranceComponent);
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent ?? '';
    expect(text).toContain('does not sell, price or issue insurance');
  });

  it('does not call the quotes endpoint on load', () => {
    // An earlier draft probed /quotes to decide what to render. Once a partner
    // exists that would write a junk quote row on every page view, and quote
    // references are the attribution trail — polluting them would make
    // reconciliation harder to trust.
    const fixture = TestBed.createComponent(InsuranceComponent);
    fixture.detectChanges();
    http.expectNone(`${environment.apiUrl}/insurance/quotes`);
  });

  describe('the enquiry form', () => {
    it('will not submit without consent', () => {
      const fixture = TestBed.createComponent(InsuranceComponent);
      const c = fixture.componentInstance;
      c.form.make = 'Maruti Suzuki';
      c.form.model = 'Swift';
      c.form.phone = '+919876543210';
      c.form.consent = false;
      expect(c.canSubmit()).toBe(false);

      c.form.consent = true;
      expect(c.canSubmit()).toBe(true);
    });

    it('accepts the ways people actually write an Indian mobile', () => {
      // Reported from the deployed page: a user typed 9999999999, the button
      // stayed disabled, and nothing said why. The +91 prefix is a formatting
      // convention, not information the user has to supply.
      const fixture = TestBed.createComponent(InsuranceComponent);
      const c = fixture.componentInstance;
      c.form.make = 'Maruti Suzuki';
      c.form.model = 'Swift';
      c.form.consent = true;

      for (const written of [
        '9999999999',
        '+919999999999',
        '919999999999',
        '09999999999',
        '99999 99999',
        '+91 99999 99999',
        '+91-9999-999-999',
      ]) {
        c.form.phone = written;
        expect(c.canSubmit()).withContext(written).toBe(true);
      }
    });

    it('normalises the number before sending it', async () => {
      const fixture = TestBed.createComponent(InsuranceComponent);
      const c = fixture.componentInstance;
      Object.assign(c.form, {
        make: 'Maruti Suzuki',
        model: 'Swift',
        phone: '99999 99999',
        consent: true,
      });

      const done = c.submit();
      const req = http.expectOne(`${environment.apiUrl}/insurance/interest`);
      // The API takes exactly one form; the user should not have to know which.
      expect(req.request.body.phone).toBe('+919999999999');
      req.flush({ id: 'x', status: 'consented', message: 'ok' });
      await done;
    });

    it('says why the button is disabled, for every reason', () => {
      // A greyed-out control with no explanation reads as a broken page. That
      // is how this was reported, so each blocking state must name itself.
      const fixture = TestBed.createComponent(InsuranceComponent);
      const c = fixture.componentInstance;

      expect(c.blockingReason()).toContain('make and model');

      c.form.make = 'Maruti Suzuki';
      c.form.model = 'Swift';
      expect(c.blockingReason()).toContain('mobile number');

      c.form.phone = '12345';
      expect(c.blockingReason()).toContain('Indian mobile number');

      c.form.phone = '9999999999';
      expect(c.blockingReason()).toContain('tick the box');

      c.form.consent = true;
      expect(c.blockingReason()).toBeNull();
    });

    it('rejects a phone number that is not an Indian mobile', () => {
      const fixture = TestBed.createComponent(InsuranceComponent);
      const c = fixture.componentInstance;
      c.form.make = 'Maruti Suzuki';
      c.form.model = 'Swift';
      c.form.consent = true;

      // 9876543210 is valid and was wrongly in this list before. These are
      // numbers no Indian mobile can be: wrong country, wrong leading digit,
      // wrong length.
      for (const bad of ['+14155551234', '1234567890', '5999999999', '99999', '']) {
        c.form.phone = bad;
        expect(c.canSubmit()).withContext(bad).toBe(false);
      }

      c.form.phone = '9876543210';
      expect(c.canSubmit()).toBe(true);
    });

    it('sends the policy expiry date through to the API', async () => {
      const fixture = TestBed.createComponent(InsuranceComponent);
      const c = fixture.componentInstance;
      Object.assign(c.form, {
        make: 'Maruti Suzuki',
        model: 'Swift',
        phone: '+919876543210',
        existing_policy_expiry: '2026-11-30',
        consent: true,
      });

      const done = c.submit();
      const req = http.expectOne(`${environment.apiUrl}/insurance/interest`);
      // The field the whole form exists to collect: it decides when someone is
      // worth contacting.
      expect(req.request.body.existing_policy_expiry).toBe('2026-11-30');
      expect(req.request.body.consent).toBe(true);
      req.flush({ id: 'x', status: 'consented', message: 'ok' });
      await done;

      expect(c.submitted()).toBe(true);
    });

    it('surfaces a failure instead of claiming success', async () => {
      const fixture = TestBed.createComponent(InsuranceComponent);
      const c = fixture.componentInstance;
      Object.assign(c.form, {
        make: 'Maruti Suzuki',
        model: 'Swift',
        phone: '+919876543210',
        consent: true,
      });

      const done = c.submit();
      http.expectOne(`${environment.apiUrl}/insurance/interest`)
        .flush({ detail: 'boom' }, { status: 500, statusText: 'Server Error' });
      await done;

      expect(c.submitted()).toBe(false);
      expect(c.error()).toBeTruthy();
    });
  });
});
