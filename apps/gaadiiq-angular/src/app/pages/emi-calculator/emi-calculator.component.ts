import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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
  imports: [CommonModule, FormsModule],
  templateUrl: './emi-calculator.component.html',
  styleUrl: './emi-calculator.component.scss'
})
export class EmiCalculatorComponent {
  loanAmount = signal(1000000);
  interestRate = signal(8.5);
  tenureMonths = signal(60);
  downPayment = signal(0);

  banks = [
    { name: 'SBI', rate: 8.45, logo: '🏦' },
    { name: 'HDFC Bank', rate: 8.75, logo: '🏛' },
    { name: 'ICICI Bank', rate: 8.85, logo: '💳' },
    { name: 'Axis Bank', rate: 9.0, logo: '🔵' },
    { name: 'Kotak Mahindra', rate: 8.65, logo: '🟠' },
  ];

  selectedBank = signal('SBI');

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
}
