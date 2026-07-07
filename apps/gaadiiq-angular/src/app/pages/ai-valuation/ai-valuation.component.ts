import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';

interface ValuationResult {
  low: number;
  mid: number;
  high: number;
  confidence: number;
  depreciation: number;
  marketTrend: string;
  tips: string[];
}

@Component({
  selector: 'app-ai-valuation',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './ai-valuation.component.html',
  styleUrl: './ai-valuation.component.scss',
})
export class AiValuationComponent {
  form = {
    make: '', model: '', year: new Date().getFullYear(),
    km: '', fuel: '', transmission: '', owners: '', condition: '',
  };

  makes = ['Maruti Suzuki','Hyundai','Tata','Mahindra','Honda','Toyota','Kia','MG Motor','Volkswagen','Skoda','Renault','Nissan','BMW','Mercedes-Benz','Audi','Other'];
  fuels = ['Petrol','Diesel','Electric','CNG','Hybrid'];
  transmissions = ['Manual','Automatic','AMT','CVT','DCT'];
  ownerOptions = ['1st Owner','2nd Owner','3rd Owner','4th+ Owner'];
  conditions = ['Excellent','Good','Fair','Needs Work'];
  get years() { const y=[]; for(let i=new Date().getFullYear();i>=2000;i--) y.push(i); return y; }

  loading = signal(false);
  result = signal<ValuationResult | null>(null);
  step = signal<'form' | 'result'>('form');

  get formValid() {
    return this.form.make && this.form.model && this.form.year && this.form.km
      && this.form.fuel && this.form.owners && this.form.condition;
  }

  async estimate() {
    if (!this.formValid) return;
    this.loading.set(true);
    await new Promise(r => setTimeout(r, 1800));

    const age = new Date().getFullYear() - this.form.year;
    const km = +this.form.km;

    // Base price by make segment
    const segmentBase: Record<string, number> = {
      'BMW': 4500000, 'Mercedes-Benz': 5000000, 'Audi': 4200000,
      'Toyota': 1800000, 'Honda': 1200000, 'Hyundai': 900000,
      'Kia': 1100000, 'MG Motor': 1300000, 'Tata': 800000,
      'Mahindra': 1000000, 'Maruti Suzuki': 700000, 'Skoda': 1400000,
      'Volkswagen': 1200000, 'Renault': 700000, 'Nissan': 750000, 'Other': 800000,
    };
    const base = segmentBase[this.form.make] || 800000;

    // Depreciation: ~15% yr1, ~10% yr2-5, ~7% yr6+
    let dep = 0;
    for (let i = 0; i < age; i++) dep += i === 0 ? 0.15 : i < 5 ? 0.10 : 0.07;
    dep = Math.min(dep, 0.75);

    // km penalty: ~1% per 10k km over 20k baseline
    const kmPenalty = Math.max(0, (km - 20000) / 10000) * 0.01;

    // Owner penalty
    const ownerPenalty = this.form.owners === '1st Owner' ? 0 :
      this.form.owners === '2nd Owner' ? 0.05 :
      this.form.owners === '3rd Owner' ? 0.10 : 0.15;

    // Condition modifier
    const condMod = this.form.condition === 'Excellent' ? 1.05 :
      this.form.condition === 'Good' ? 1.0 :
      this.form.condition === 'Fair' ? 0.92 : 0.82;

    // Fuel premium (EV/Hybrid hold value better)
    const fuelMod = this.form.fuel === 'Electric' ? 1.08 :
      this.form.fuel === 'Hybrid' ? 1.04 : 1.0;

    const mid = Math.round(base * (1 - dep - kmPenalty - ownerPenalty) * condMod * fuelMod / 1000) * 1000;
    const low = Math.round(mid * 0.9 / 1000) * 1000;
    const high = Math.round(mid * 1.1 / 1000) * 1000;

    const depPct = Math.round((dep + kmPenalty + ownerPenalty) * 100);
    const trend = this.form.fuel === 'Electric' ? '📈 EVs are in strong demand right now' :
      this.form.fuel === 'Diesel' ? '📉 Diesel resale softening in metros' :
      '➡️ Petrol market is stable';

    const tips: string[] = [];
    if (km > 80000) tips.push('High mileage — a service record will boost buyer confidence.');
    if (age >= 5) tips.push('Consider a fresh paint polish to improve first impression.');
    if (this.form.owners !== '1st Owner') tips.push('Highlight any warranties or extended service packages.');
    if (this.form.condition !== 'Excellent') tips.push('Minor dent/scratch repairs can add ₹20–40k to the selling price.');
    if (tips.length === 0) tips.push('Your car is in great shape — list at the high end of the range!');

    this.result.set({ low, mid, high, confidence: 87 + Math.round(Math.random() * 8), depreciation: depPct, marketTrend: trend, tips });
    this.loading.set(false);
    this.step.set('result');
  }

  reset() { this.step.set('form'); this.result.set(null); }

  fmt(p: number) { return p >= 100000 ? `₹${(p/100000).toFixed(1)}L` : `₹${p.toLocaleString('en-IN')}`; }
}
