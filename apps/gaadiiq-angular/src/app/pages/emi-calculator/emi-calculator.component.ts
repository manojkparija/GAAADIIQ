import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { IconComponent } from '../../components/icon/icon.component';

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
  imports: [CommonModule, FormsModule, IconComponent],
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
  banks = [
    { name: 'SBI', rate: 8.45, logo: '🏦' },
    { name: 'HDFC Bank', rate: 8.75, logo: '🏛' },
    { name: 'ICICI Bank', rate: 8.85, logo: '💳' },
    { name: 'Axis Bank', rate: 9.0, logo: '🔵' },
    { name: 'Kotak Mahindra', rate: 8.65, logo: '🟠' },
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

  selectBank(bank: { name: string; rate: number; logo: string }) {
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

  affordabilityScore = computed(() => {
    const income = this.monthlyIncome();
    const dti = this.dtiAfter();
    const surplus = income - this.existingEmis() - this.emi() - this.monthlyExpenses();
    const buffer = income * 0.15; // 15% emergency buffer
    let score = 100;
    if (dti > 50) score -= 40;
    else if (dti > 40) score -= 25;
    else if (dti > 30) score -= 10;
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
    this.monthlyIncome() - this.existingEmis() - this.emi() - this.monthlyExpenses()
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
