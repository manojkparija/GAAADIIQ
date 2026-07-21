import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';

interface TcoResult {
  label: string;
  evTotal: number;
  petrolTotal: number;
  saving: number;
  breakEvenMonths: number;
}

@Component({
  selector: 'app-ev-calculator',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './ev-calculator.component.html',
  styleUrl: './ev-calculator.component.scss',
})
export class EvCalculatorComponent {
  // EV inputs
  evPrice       = signal(1500000);    // ₹15L
  evRangeKm     = signal(400);        // km per full charge
  chargingCostPer100km = signal(120); // ₹ per 100km

  // Petrol inputs
  petrolPrice   = signal(1200000);    // ₹12L
  mileageKmpl   = signal(18);         // km per litre
  petrolPriceL  = signal(106);        // ₹ per litre

  // Common inputs
  dailyKm       = signal(40);
  annualInsurance = signal(0.035);    // 3.5% of vehicle price
  evMaintPerYr  = signal(8000);       // EV annual maintenance
  petrolMaintPerYr = signal(14000);   // Petrol annual maintenance
  years         = signal(5);

  // FAME-II subsidy (simplified, up to ₹1.5L for eligible EVs)
  fameSubsidy   = computed(() => this.evPrice() >= 1000000 && this.evPrice() <= 2000000 ? 150000 : 0);

  effectiveEvPrice = computed(() => Math.max(0, this.evPrice() - this.fameSubsidy()));

  annualKm = computed(() => this.dailyKm() * 365);

  evAnnualFuel    = computed(() => (this.annualKm() / 100) * this.chargingCostPer100km());
  petrolAnnualFuel = computed(() => (this.annualKm() / this.mileageKmpl()) * this.petrolPriceL());

  evAnnualInsurance     = computed(() => this.evPrice() * this.annualInsurance());
  petrolAnnualInsurance = computed(() => this.petrolPrice() * this.annualInsurance());

  tco = computed<TcoResult>(() => {
    const yrs = this.years();
    const evRunning     = (this.evAnnualFuel() + this.evMaintPerYr() + this.evAnnualInsurance()) * yrs;
    const petrolRunning = (this.petrolAnnualFuel() + this.petrolMaintPerYr() + this.petrolAnnualInsurance()) * yrs;

    const evTotal     = this.effectiveEvPrice() + evRunning;
    const petrolTotal = this.petrolPrice() + petrolRunning;
    const saving      = petrolTotal - evTotal;

    // Monthly saving (EV typically saves on fuel+maintenance once bought)
    const monthlyFuelSaving = (this.petrolAnnualFuel() - this.evAnnualFuel()) / 12
                            + (this.petrolMaintPerYr() - this.evMaintPerYr()) / 12;
    const extraUpfront = this.effectiveEvPrice() - this.petrolPrice();
    const breakEvenMonths = monthlyFuelSaving > 0 ? Math.ceil(extraUpfront / monthlyFuelSaving) : Infinity;

    return { label: `${yrs}-Year TCO`, evTotal, petrolTotal, saving, breakEvenMonths };
  });

  monthlyCostEv     = computed(() => this.tco().evTotal / (this.years() * 12));
  monthlyCostPetrol = computed(() => this.tco().petrolTotal / (this.years() * 12));

  fmtP(n: number): string {
    if (n >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)}Cr`;
    if (n >= 100_000)    return `₹${(n / 100_000).toFixed(1)}L`;
    return `₹${Math.round(n).toLocaleString('en-IN')}`;
  }

  constructor(seo: SeoService) {
    seo.setPage('EV vs Petrol TCO Calculator', 'Compare the 5-year total cost of ownership for electric vs petrol cars in India.');
  }
}
