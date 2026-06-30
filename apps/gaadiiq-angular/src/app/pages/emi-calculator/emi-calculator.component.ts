import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-emi-calculator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './emi-calculator.component.html',
  styleUrls: ['./emi-calculator.component.scss']
})
export class EmiCalculatorComponent {
  loanAmount = signal(1500000);   // ₹15L default
  interestRate = signal(10);       // 10%
  tenureMonths = signal(60);       // 5 years

  monthlyEmi = computed(() => {
    const P = this.loanAmount();
    const r = this.interestRate() / 12 / 100;
    const n = this.tenureMonths();
    if (r === 0) return P / n;
    return (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  });

  totalAmount = computed(() => this.monthlyEmi() * this.tenureMonths());
  totalInterest = computed(() => this.totalAmount() - this.loanAmount());

  principalPercent = computed(() => (this.loanAmount() / this.totalAmount()) * 100);
  interestPercent = computed(() => (this.totalInterest() / this.totalAmount()) * 100);

  // Amortization schedule (yearly summary)
  amortizationYears = computed(() => {
    const P = this.loanAmount();
    const r = this.interestRate() / 12 / 100;
    const n = this.tenureMonths();
    const emi = this.monthlyEmi();
    const years = Math.ceil(n / 12);

    const result = [];
    let balance = P;

    for (let y = 1; y <= years; y++) {
      const monthsInYear = Math.min(12, n - (y - 1) * 12);
      let yearPrincipal = 0;
      let yearInterest = 0;

      for (let m = 0; m < monthsInYear; m++) {
        const interestForMonth = balance * r;
        const principalForMonth = emi - interestForMonth;
        yearInterest += interestForMonth;
        yearPrincipal += principalForMonth;
        balance -= principalForMonth;
      }

      result.push({
        year: y,
        principal: yearPrincipal,
        interest: yearInterest,
        balance: Math.max(0, balance),
        total: yearPrincipal + yearInterest
      });
    }

    return result;
  });

  maxBarValue = computed(() => {
    const years = this.amortizationYears();
    return Math.max(...years.map(y => y.total));
  });

  formatCurrency(val: number): string {
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)} Cr`;
    if (val >= 100000) return `₹${(val / 100000).toFixed(2)} L`;
    return `₹${Math.round(val).toLocaleString('en-IN')}`;
  }

  formatLakhs(val: number): string {
    return `₹${(val / 100000).toFixed(1)}L`;
  }

  onLoanChange(event: Event) {
    this.loanAmount.set(Number((event.target as HTMLInputElement).value));
  }

  onRateChange(event: Event) {
    this.interestRate.set(Number((event.target as HTMLInputElement).value));
  }

  onTenureChange(event: Event) {
    this.tenureMonths.set(Number((event.target as HTMLInputElement).value));
  }
}
