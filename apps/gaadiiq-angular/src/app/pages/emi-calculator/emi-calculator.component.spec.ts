/**
 * Affordability, including what the car costs to keep.
 *
 * The analysis counted the loan and nothing else: a ₹20,000 EMI was treated as
 * ₹20,000 a month when fuel, servicing and insurance make the real outgoing
 * nearer ₹28,000. Someone could be shown "Excellent" and still be short every
 * month.
 *
 * The standard being applied is 20/4/10 — 20% down, a term of four years or
 * less, and *all* car costs within 10% of gross monthly income. The third test
 * is explicitly about total transport cost, not the EMI, which is why running
 * costs had to exist before the rule could be shown at all.
 */

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { EmiCalculatorComponent } from './emi-calculator.component';

describe('EmiCalculatorComponent affordability', () => {
  let c: any;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [EmiCalculatorComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    c = TestBed.createComponent(EmiCalculatorComponent).componentInstance;
  });

  it('adds running costs at 40% of the EMI by default', () => {
    expect(c.runningCostPercent()).toBe(40);
    expect(c.runningCosts()).toBe(Math.round(c.emi() * 0.4));
    expect(c.totalCarCost()).toBe(c.emi() + c.runningCosts());
  });

  it('counts running costs against the monthly surplus', () => {
    // They leave the account every month whether or not anyone budgeted them.
    const withCosts = c.monthlySurplus();

    c.runningCostPercent.set(0);
    const withoutCosts = c.monthlySurplus();

    expect(withoutCosts - withCosts).toBe(Math.round(c.emi() * 0.4));
  });

  it('measures the 10% test against total car cost, not the EMI', () => {
    // The reported shape: ₹2,00,000 income, ₹40,000 of existing EMIs, and a
    // car loan on top. Whatever the EMI works out to, the rule must be applied
    // to EMI + running costs — that is what "all car costs" means, and it is
    // the difference between a car that fits and one that only looks like it.
    c.monthlyIncome.set(200000);
    c.existingEmis.set(40000);

    const emi = c.emi();
    const emiOnlyRatio = Math.round((emi / 200000) * 100);

    expect(c.runningCosts()).toBe(Math.round(emi * 0.4));
    expect(c.totalCarCost()).toBe(emi + Math.round(emi * 0.4));
    expect(c.carCostRatio()).toBe(Math.round((c.totalCarCost() / 200000) * 100));
    expect(c.carCostRatio())
      .withContext('the rule is still being applied to the EMI alone')
      .toBeGreaterThan(emiOnlyRatio);
  });

  it('scores an over-budget car lower than the same loan without running costs', () => {
    c.monthlyIncome.set(200000);
    c.existingEmis.set(40000);

    c.runningCostPercent.set(0);
    const lean = c.affordabilityScore();

    c.runningCostPercent.set(80);
    const heavy = c.affordabilityScore();

    expect(heavy).withContext('running costs made no difference to the score').toBeLessThan(lean);
  });

  it('does not call a car costing a third of income "Excellent"', () => {
    // The first draft did: the 10% test failed by 26 points and the label was
    // still the top one, because the penalty was too small to move it.
    c.monthlyIncome.set(80000);
    c.existingEmis.set(0);
    c.runningCostPercent.set(40);

    expect(c.carCostRatio()).toBeGreaterThan(30);
    expect(c.affordabilityLabel().label).not.toBe('Excellent');
  });

  it('reports the down payment and term for the other two tests', () => {
    c.loanAmount.set(1000000);
    c.downPayment.set(200000);
    c.tenureMonths.set(48);

    expect(c.downPaymentPercent()).toBe(20);
    expect(c.termYears()).toBe(4);
  });

  it('shows the rule and the running-cost slider on the page', () => {
    const fixture = TestBed.createComponent(EmiCalculatorComponent);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('20/4/10');
    expect(text).toContain('Running costs');
    expect(text).toContain('True cost of this car');
    // Said to be an estimate, because it is one.
    expect(text).toMatch(/estimated at \d+% of the EMI/);
  });

  it('leaves the running-cost share adjustable rather than fixed at 40%', () => {
    // 40% is a rule of thumb, not a fact about anyone's car.
    c.runningCostPercent.set(15);
    expect(c.runningCosts()).toBe(Math.round(c.emi() * 0.15));
  });
});
