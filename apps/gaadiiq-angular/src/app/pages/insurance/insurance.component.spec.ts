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

    it('rejects a phone number that is not an Indian mobile', () => {
      const fixture = TestBed.createComponent(InsuranceComponent);
      const c = fixture.componentInstance;
      c.form.make = 'Maruti Suzuki';
      c.form.model = 'Swift';
      c.form.consent = true;

      for (const bad of ['+14155551234', '9876543210', '+911234567890', '']) {
        c.form.phone = bad;
        expect(c.canSubmit()).withContext(bad).toBe(false);
      }

      c.form.phone = '+919876543210';
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
