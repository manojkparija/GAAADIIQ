import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

type FuelType = 'petrol' | 'diesel' | 'electric' | 'cng';

interface FuelDefaults {
  price: number;
  mileage: number;
  label: string;
  /** Wording changes for electric: ₹/kWh and km/kWh rather than ₹/L and km/L. */
  priceLabel: string;
  mileageLabel: string;
}

const FUEL_DEFAULTS: Record<FuelType, FuelDefaults> = {
  petrol: { price: 100, mileage: 15, label: 'Petrol', priceLabel: 'Fuel Price (₹/L)', mileageLabel: 'Mileage (km/L)' },
  diesel: { price: 88, mileage: 18, label: 'Diesel', priceLabel: 'Fuel Price (₹/L)', mileageLabel: 'Mileage (km/L)' },
  electric: { price: 8, mileage: 100, label: 'Electric', priceLabel: 'Electricity (₹/kWh)', mileageLabel: 'Range (km/kWh)' },
  cng: { price: 75, mileage: 22, label: 'CNG', priceLabel: 'CNG Price (₹/kg)', mileageLabel: 'Mileage (km/kg)' },
};

/**
 * Annual depreciation rates, an approximation of the Indian used-car market.
 * Year 6 onwards reuses the final rate.
 */
const DEPRECIATION = [0.2, 0.15, 0.12, 0.10, 0.08];

@Component({
  selector: 'app-tco',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tco.component.html',
  styleUrl: './tco.component.scss',
})
export class TcoComponent {
  readonly fuelTypes = Object.keys(FUEL_DEFAULTS) as FuelType[];
  readonly fuelDefaults = FUEL_DEFAULTS;

  purchasePrice = signal(1000000);
  fuelType = signal<FuelType>('petrol');
  kmPerYear = signal(15000);
  yearsOwned = signal(5);
  insurancePremiumPct = signal(3);
  maintenancePerYear = signal(15000);
  fuelPricePerLitre = signal(100);
  mileageKmpl = signal(15);

  /** Labels track the selected fuel so electric reads in kWh, not litres. */
  priceLabel = computed(() => FUEL_DEFAULTS[this.fuelType()].priceLabel);
  mileageLabel = computed(() => FUEL_DEFAULTS[this.fuelType()].mileageLabel);

  private years = computed(() => Math.min(Math.max(1, this.yearsOwned()), 10));

  resaleValue = computed(() => {
    let value = this.purchasePrice();
    for (let y = 0; y < this.years(); y++) {
      value *= 1 - DEPRECIATION[Math.min(y, DEPRECIATION.length - 1)];
    }
    return value;
  });

  depreciation = computed(() => this.purchasePrice() - this.resaleValue());
  private totalKm = computed(() => this.kmPerYear() * this.years());

  fuelCost = computed(() => {
    const mileage = this.mileageKmpl();
    // Guard the divisor: the input is user-editable and 0 would yield Infinity.
    return mileage > 0 ? (this.totalKm() / mileage) * this.fuelPricePerLitre() : 0;
  });

  insurance = computed(() => this.purchasePrice() * (this.insurancePremiumPct() / 100) * this.years());
  maintenance = computed(() => this.maintenancePerYear() * this.years());

  total = computed(() => this.depreciation() + this.fuelCost() + this.insurance() + this.maintenance());
  perYear = computed(() => this.total() / this.years());
  perKm = computed(() => (this.totalKm() > 0 ? this.total() / this.totalKm() : 0));

  retainedPct = computed(() => {
    const price = this.purchasePrice();
    return price > 0 ? (this.resaleValue() / price) * 100 : 0;
  });

  selectFuel(ft: FuelType): void {
    this.fuelType.set(ft);
    this.fuelPricePerLitre.set(FUEL_DEFAULTS[ft].price);
    this.mileageKmpl.set(FUEL_DEFAULTS[ft].mileage);
  }

  /** Share of the grand total, for the breakdown bars. */
  share(value: number): number {
    const total = this.total();
    return total > 0 ? (value / total) * 100 : 0;
  }

  formatINR(n: number): string {
    if (!isFinite(n)) return '—';
    if (n >= 1_00_00_000) return `₹${(n / 1_00_00_000).toFixed(2)} Cr`;
    if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)} L`;
    return `₹${Math.round(n).toLocaleString('en-IN')}`;
  }
}
