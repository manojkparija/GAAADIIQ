/**
 * Carrying a loan from a car's EMI card into the application.
 *
 * "Apply for Loan →" on the car detail page had no click handler at all — the
 * primary call to action on the EMI card did nothing when pressed. Wiring it up
 * is only half the fix: landing on a form defaulted to a ₹6L car and a ₹5L loan
 * throws away the price, amount and tenure the buyer just set, so the offers
 * they compare are for a different car than the one they were looking at.
 *
 * The parameters arrive in a URL a user can edit, so every one is validated.
 * A NaN reaching the sliders leaves the form unusable with nothing on screen to
 * say why.
 */
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { CarLoanComponent } from './car-loan.component';
import { CarLoanService } from '../../services/car-loan.service';

function build(queryParams: Record<string, string>) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CarLoanComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: CarLoanService,
        useValue: {
          partners: () => Promise.resolve([]),
          formatRupees: (v: number) => `₹${v}`,
        },
      },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } },
      },
    ],
  });
  const c = TestBed.createComponent(CarLoanComponent).componentInstance as any;
  void c.ngOnInit();
  return c;
}

describe('CarLoanComponent — prefill from a car', () => {
  it('takes the price, amount, tenure and car across', () => {
    const c = build({
      price: '490000', amount: '390000', tenure: '48',
      car: 'Maruti Suzuki S-Presso', condition: 'new',
    });

    expect(c.vehiclePrice()).toBe(490000);
    expect(c.loanAmount()).toBe(390000);
    expect(c.tenureMonths()).toBe(48);
    expect(c.form.vehicle_description).toBe('Maruti Suzuki S-Presso');
    expect(c.form.vehicle_condition).toBe('new');
  });

  it('keeps its defaults when arrived at directly', () => {
    const c = build({});

    expect(c.vehiclePrice()).toBe(600000);
    expect(c.loanAmount()).toBe(500000);
    expect(c.tenureMonths()).toBe(60);
  });

  it('carries a used car across as used', () => {
    const c = build({ condition: 'used', car: 'Hyundai i20 2019' });

    expect(c.form.vehicle_condition).toBe('used');
  });
});

describe('CarLoanComponent — a URL is user input', () => {
  it('ignores values that are not numbers', () => {
    const c = build({ price: 'abc', amount: 'null', tenure: '' });

    expect(c.vehiclePrice()).toBe(600000);
    expect(c.loanAmount()).toBe(500000);
    expect(Number.isNaN(c.vehiclePrice())).toBeFalse();
  });

  it('ignores negative and zero amounts', () => {
    const c = build({ price: '-5', amount: '0' });

    expect(c.vehiclePrice()).toBe(600000);
    expect(c.loanAmount()).toBe(500000);
  });

  it('will not seed a loan larger than the vehicle price', () => {
    // The form's own rule; the API rejects it with a 422. A hand-edited URL
    // must not be able to put the form into a state it will refuse to submit.
    const c = build({ price: '400000', amount: '900000' });

    expect(c.vehiclePrice()).toBe(400000);
    expect(c.loanAmount()).toBe(400000);
  });

  it('ignores a tenure outside what any lender offers', () => {
    expect(build({ tenure: '9999' }).tenureMonths()).toBe(60);
    expect(build({ tenure: '3' }).tenureMonths()).toBe(60);
  });

  it('accepts the tenure bounds themselves', () => {
    expect(build({ tenure: '12' }).tenureMonths()).toBe(12);
    expect(build({ tenure: '84' }).tenureMonths()).toBe(84);
  });

  it('truncates an overlong car description rather than sending it', () => {
    const c = build({ car: 'x'.repeat(500) });

    expect(c.form.vehicle_description.length).toBe(200);
  });
});
