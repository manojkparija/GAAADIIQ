/**
 * The "Best Rate" badge, and what the compared rates actually are.
 *
 * The badge was `bank.rate === 8.45` — a literal, matched by equality against
 * rates that come from the lenders' own cards. The moment a card moved, the
 * badge either sat on a bank that was no longer cheapest or disappeared from
 * the list altogether, and a hardcoded number cannot be wrong in a way anything
 * would catch.
 *
 * The rates themselves are every lender's lowest slab — the excellent-credit
 * figure they advertise. An applicant who supplies no credit score is priced in
 * "unknown" instead: 10.50% at SBI against the 8.45% shown, ₹8,383 a month
 * rather than ₹6,976 on ₹3.4L over 60 months. The calculator quoted the first
 * and the application returned the second, with nothing on either screen
 * admitting they answered different questions.
 */
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { EmiCalculatorComponent } from './emi-calculator.component';
import { environment } from '../../../environments/environment';

function build() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [EmiCalculatorComponent],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(EmiCalculatorComponent);
  fixture.detectChanges(); // triggers ngOnInit -> GET /loans/bank-rates
  return {
    c: fixture.componentInstance as any,
    http: TestBed.inject(HttpTestingController),
  };
}

function answerWith(http: HttpTestingController, body: Record<string, unknown>) {
  http.expectOne(`${environment.apiUrl}/loans/bank-rates`).flush(body);
}

describe('EmiCalculatorComponent — best rate badge', () => {
  it('follows the cheapest bank actually returned', () => {
    const { c, http } = build();
    answerWith(http, {
      banks: [
        { name: 'HDFC Bank', rate: 9.1 },
        { name: 'ICICI Bank', rate: 7.99 },
        { name: 'State Bank of India', rate: 8.45 },
      ],
    });

    expect(c.lowestRate()).toBe(7.99);
  });

  it('does not stay pinned to 8.45 when every rate has moved', () => {
    // The exact regression: with the old literal, a table where nothing is at
    // 8.45 showed no "Best Rate" badge at all.
    const { c, http } = build();
    answerWith(http, {
      banks: [
        { name: 'HDFC Bank', rate: 9.6 },
        { name: 'ICICI Bank', rate: 9.15 },
      ],
    });

    expect(c.lowestRate()).toBe(9.15);
    expect(c.lowestRate()).not.toBe(8.45);
  });

  it('recomputes after the API replaces the stub rates', () => {
    // lowestRate() is a method, not a computed(): `banks` is a plain array
    // reassigned when the response lands, and computed() tracks signal reads
    // only, so a computed would have frozen on the stub values forever.
    const { c, http } = build();
    const beforeApi = c.lowestRate();

    answerWith(http, { banks: [{ name: 'Only Bank', rate: 6.25 }] });

    expect(beforeApi).toBe(8.45);        // the stub table's cheapest
    expect(c.lowestRate()).toBe(6.25);   // and it moved
  });

  it('survives an empty bank list without dividing by nothing', () => {
    const { c, http } = build();
    answerWith(http, { banks: [] });

    // Empty payload keeps the stubs, so the badge still has something to mark.
    expect(c.lowestRate()).toBeGreaterThan(0);
    expect(Number.isFinite(c.lowestRate())).toBeTrue();
  });
});

describe('EmiCalculatorComponent — saying what the rates are', () => {
  it('shows the API note about whose rate this is', () => {
    const { c, http } = build();
    answerWith(http, {
      banks: [{ name: 'State Bank of India', rate: 8.45 }],
      rate_basis: 'excellent',
      note: 'Lowest published rate, for applicants with an excellent credit record.',
    });

    expect(c.rateNote()).toContain('excellent credit');
  });

  it('says nothing rather than something wrong when the API is unreachable', () => {
    // Stub rates are still shown, but no claim is made about whose rate they
    // are — an unqualified promise is worse than a missing caption.
    const { c, http } = build();
    http.expectOne(`${environment.apiUrl}/loans/bank-rates`)
      .error(new ProgressEvent('network'));

    expect(c.rateNote()).toBeNull();
    expect(c.banks.length).toBeGreaterThan(0);
  });
});
