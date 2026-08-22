import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { IconComponent } from '../../components/icon/icon.component';
import { LenderMarkComponent } from '../../components/lender-mark/lender-mark.component';
import { TranslatePipe } from '../../pipes/translate.pipe';

interface AmortizationRow {
  month: number;
  emi: number;
  principal: number;
  interest: number;
  balance: number;
}

@Component({
  selector: 'app-emi-calculator',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, LenderMarkComponent, TranslatePipe],
  templateUrl: './emi-calculator.component.html',
  styleUrl: './emi-calculator.component.scss'
})
export class EmiCalculatorComponent implements OnInit {
  private readonly http = inject(HttpClient);

  loanAmount = signal(1000000);
  interestRate = signal(8.5);
  tenureMonths = signal(60);
  downPayment = signal(0);

  // Loaded from GET /loans/emi-calculator; stubs are shown until API responds (MOB-031)
  banks: { name: string; rate: number }[] = [
    { name: 'SBI', rate: 8.45 },
    { name: 'HDFC Bank', rate: 8.75 },
    { name: 'ICICI Bank', rate: 8.85 },
    { name: 'Axis Bank', rate: 9.0 },
    { name: 'Kotak Mahindra', rate: 8.65 },
  ];

  selectedBank = signal('SBI');

  ngOnInit() {
    this.http.get<any>(`${environment.apiUrl}/loans/bank-rates`).subscribe({
      next: res => {
        if (res?.banks?.length) {
          this.banks = res.banks;
          // Refresh selected rate with first bank from API
          this.interestRate.set(this.banks[0].rate);
          this.selectedBank.set(this.banks[0].name);
        }
      },
      error: () => { /* keep stub rates on API failure */ },
    });
  }

  // Affordability inputs
  monthlyIncome = signal(80000);
  existingEmis = signal(0);
  monthlyExpenses = signal(25000);

  selectBank(bank: { name: string; rate: number }) {
    this.selectedBank.set(bank.name);
    this.interestRate.set(bank.rate);
  }

  principal = computed(() => this.loanAmount() - this.downPayment());

  emi = computed(() => {
    const p = this.principal();
    const r = this.interestRate() / 12 / 100;
    const n = this.tenureMonths();
    if (r === 0) return p / n;
    return Math.round(p * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
  });

  totalAmount = computed(() => this.emi() * this.tenureMonths());
  totalInterest = computed(() => this.totalAmount() - this.principal());

  principalPercent = computed(() => Math.round(this.principal() / this.totalAmount() * 100));
  interestPercent = computed(() => 100 - this.principalPercent());

  donutDash = computed(() => {
    const circumference = 2 * Math.PI * 54;
    return circumference;
  });
  principalDash = computed(() => (this.principalPercent() / 100) * this.donutDash());
  interestDash = computed(() => (this.interestPercent() / 100) * this.donutDash());

  amortization = computed((): AmortizationRow[] => {
    const rows: AmortizationRow[] = [];
    let balance = this.principal();
    const r = this.interestRate() / 12 / 100;
    const emiVal = this.emi();
    for (let m = 1; m <= Math.min(this.tenureMonths(), 12); m++) {
      const interest = Math.round(balance * r);
      const principal = emiVal - interest;
      balance = Math.max(0, balance - principal);
      rows.push({ month: m, emi: emiVal, principal, interest, balance });
    }
    return rows;
  });

  // Affordability computed signals
  dtiCurrent = computed(() => {
    const income = this.monthlyIncome();
    if (!income) return 0;
    return Math.round((this.existingEmis() / income) * 100);
  });

  dtiAfter = computed(() => {
    const income = this.monthlyIncome();
    if (!income) return 0;
    return Math.round(((this.existingEmis() + this.emi()) / income) * 100);
  });

  /**
   * Running costs as a share of the EMI — fuel, servicing, insurance, tyres.
   *
   * A car costs money to own as well as to buy, and this analysis counted only
   * the loan: a ₹20,000 EMI was treated as ₹20,000 a month when the true
   * outgoing is closer to ₹28,000. Someone shown "Excellent" could still be
   * short every month.
   *
   * Expressed as a percentage of the EMI rather than a rupee figure so it
   * tracks the loan as the sliders move, and left adjustable because 40% is a
   * rule of thumb, not a fact about anyone's car. A 10-year-old diesel driven
   * 2,000 km a month and a new hatchback driven to the station are not the
   * same number.
   */
  runningCostPercent = signal(40);

  runningCosts = computed(() => Math.round(this.emi() * this.runningCostPercent() / 100));

  /** Everything the car costs each month: the loan plus keeping it on the road. */
  totalCarCost = computed(() => this.emi() + this.runningCosts());

  /**
   * The 10 in the 20/4/10 rule: total transport cost as a share of income.
   *
   * The rule is 20% down, a term of 4 years or less, and all car costs — not
   * just the EMI — within 10% of gross monthly income. The third test is the
   * one this page was missing, and it is the one that catches an affordable
   * loan on an unaffordable car.
   */
  carCostRatio = computed(() => {
    const income = this.monthlyIncome();
    if (!income) return 0;
    return Math.round((this.totalCarCost() / income) * 100);
  });

  /** Down payment as a share of the car's price — the 20 in 20/4/10. */
  downPaymentPercent = computed(() => {
    const price = this.loanAmount();
    if (!price) return 0;
    return Math.round((this.downPayment() / price) * 100);
  });

  /** Term in years, for the 4 in 20/4/10. */
  termYears = computed(() => Math.round((this.tenureMonths() / 12) * 10) / 10);

  affordabilityScore = computed(() => {
    const income = this.monthlyIncome();
    const dti = this.dtiAfter();
    // Running costs belong in the surplus: they leave the account every month
    // whether or not anyone budgeted for them.
    const surplus = income - this.existingEmis() - this.totalCarCost() - this.monthlyExpenses();
    const buffer = income * 0.15; // 15% emergency buffer
    let score = 100;
    if (dti > 50) score -= 40;
    else if (dti > 40) score -= 25;
    else if (dti > 30) score -= 10;
    // The 20/4/10 test, weighted below DTI: exceeding it is a warning about
    // the car being too much car, not a sign the lender will refuse.
    // Weighted below DTI — a lender cares about DTI, this is guidance about
    // whether the car is too much car. But the penalty has to be big enough to
    // move the verdict: at 36% of income the first draft still read
    // "Excellent", which is not a description anyone should act on.
    const carRatio = this.carCostRatio();
    if (carRatio > 30) score -= 40;
    else if (carRatio > 20) score -= 30;
    else if (carRatio > 15) score -= 12;
    else if (carRatio > 10) score -= 6;
    if (surplus < buffer) score -= 20;
    if (surplus < 0) score -= 30;
    return Math.max(0, Math.min(100, score));
  });

  affordabilityLabel = computed(() => {
    const s = this.affordabilityScore();
    // Tokens, not hex. These feed [style.color] on the gauge's score and label,
    // which sit on a white card: #43E97B measured about 1.8:1 there, so
    // "Excellent" was legible only to someone who already knew what it said.
    // The *ink tokens carry a light-mode value that passes AA and resolve back
    // to these exact bright colours in dark mode.
    if (s >= 80) return { label: 'Excellent', color: 'var(--success-ink)' };
    if (s >= 60) return { label: 'Good', color: 'var(--info-ink)' };
    if (s >= 40) return { label: 'Fair', color: 'var(--warning-ink)' };
    return { label: 'Stretched', color: 'var(--danger-ink)' };
  });

  monthlySurplus = computed(() =>
    this.monthlyIncome() - this.existingEmis() - this.totalCarCost() - this.monthlyExpenses()
  );

  emergencyBufferOk = computed(() =>
    this.monthlySurplus() >= this.monthlyIncome() * 0.15
  );

  bankEmi(rate: number) {
    const p = this.principal();
    const r = rate / 12 / 100;
    const n = this.tenureMonths();
    if (r === 0) return p / n;
    return Math.round(p * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
  }

  fmt(n: number) {
    if (n >= 100000) return `₹${(n/100000).toFixed(1)}L`;
    if (n >= 1000) return `₹${(n/1000).toFixed(0)}K`;
    return `₹${n}`;
  }

  fmtExact(n: number) {
    return `₹${Math.round(n).toLocaleString('en-IN')}`;
  }
}
