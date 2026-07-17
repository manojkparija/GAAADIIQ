import { Injectable } from '@angular/core';
import { Car } from './cars-data.service';

export interface TcoBreakdown {
  purchasePrice: number;
  registration: number;
  insurance5yr: number;
  fuel5yr: number;
  maintenance5yr: number;
  total5yr: number;
  monthlyCost: number;
  resaleValue: number;
  netCost5yr: number;
}

export interface ResaleAnalysis {
  currentValue: number;
  value1yr: number;
  value3yr: number;
  value5yr: number;
  depreciationRate: number;
  verdict: string;
  verdictColor: string;
}

const FUEL_COST_PER_KM: Record<string, number> = {
  Petrol: 8.5, Diesel: 6.2, CNG: 3.8, Electric: 1.2, Hybrid: 4.5,
};

const MAINT_PER_YEAR: Record<string, number> = {
  Petrol: 18000, Diesel: 22000, CNG: 16000, Electric: 8000, Hybrid: 14000,
};

const DEPRECIATION: Record<string, number> = {
  Petrol: 0.15, Diesel: 0.13, CNG: 0.18, Electric: 0.20, Hybrid: 0.14,
};

const ANNUAL_KM = 15000;

// IRDAI 2023-24 TP premium by engine size (proxied by price band) + 2% OD
function insuranceFirstYear(price: number): number {
  const tp = price < 600000 ? 2094 : price < 1500000 ? 3416 : 7897;
  const od = Math.round(price * 0.02);
  return tp + od;
}

// National average registration rate (used for TCO; on-road widget uses state-specific)
function regRate(fuel: string): number {
  return fuel === 'Electric' ? 0.00 : 0.09; // EVs exempt in most states
}

@Injectable({ providedIn: 'root' })
export class TcoService {

  calculateTco(car: Car): TcoBreakdown {
    const fuel = car.fuel || 'Petrol';
    const price = car.price;
    const registration = price * regRate(fuel);
    // Insurance: year 1 full premium, years 2-5 at ~60% (no OD renewal inflation)
    const insurance5yr = insuranceFirstYear(price) + insuranceFirstYear(price) * 0.6 * 4;
    const fuelPerKm = FUEL_COST_PER_KM[fuel] ?? 8;
    const fuel5yr = fuelPerKm * ANNUAL_KM * 5;
    const maintenance5yr = (MAINT_PER_YEAR[fuel] ?? 18000) * 5;
    const total5yr = price + registration + insurance5yr + fuel5yr + maintenance5yr;
    const resaleValue = this.getResale(car, 5);
    const netCost5yr = total5yr - resaleValue;
    return {
      purchasePrice: price,
      registration: Math.round(registration),
      insurance5yr: Math.round(insurance5yr),
      fuel5yr: Math.round(fuel5yr),
      maintenance5yr: Math.round(maintenance5yr),
      total5yr: Math.round(total5yr),
      monthlyCost: Math.round(netCost5yr / 60),
      resaleValue: Math.round(resaleValue),
      netCost5yr: Math.round(netCost5yr),
    };
  }

  calculateResale(car: Car): ResaleAnalysis {
    const dep = DEPRECIATION[car.fuel] ?? 0.15;
    const age = new Date().getFullYear() - car.year;
    const base = car.price * Math.pow(1 - dep, age);
    const v1 = base * (1 - dep);
    const v3 = base * Math.pow(1 - dep, 3);
    const v5 = base * Math.pow(1 - dep, 5);

    let verdict = '';
    let verdictColor = '';
    if (dep <= 0.13) { verdict = 'Excellent resale value'; verdictColor = 'green'; }
    else if (dep <= 0.16) { verdict = 'Good resale value'; verdictColor = 'blue'; }
    else if (dep <= 0.18) { verdict = 'Average resale value'; verdictColor = 'gold'; }
    else { verdict = 'High depreciation — EV tech still evolving'; verdictColor = 'red'; }

    return {
      currentValue: Math.round(base),
      value1yr: Math.round(v1),
      value3yr: Math.round(v3),
      value5yr: Math.round(v5),
      depreciationRate: Math.round(dep * 100),
      verdict,
      verdictColor,
    };
  }

  private getResale(car: Car, years: number): number {
    const dep = DEPRECIATION[car.fuel] ?? 0.15;
    return car.price * Math.pow(1 - dep, years);
  }

  compareTco(cars: Car[]): { car: Car; tco: TcoBreakdown; rank: number }[] {
    const results = cars.map(car => ({ car, tco: this.calculateTco(car) }));
    results.sort((a, b) => a.tco.netCost5yr - b.tco.netCost5yr);
    return results.map((r, i) => ({ ...r, rank: i + 1 }));
  }

  fmt(n: number): string {
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    return `₹${(n / 1000).toFixed(0)}k`;
  }
}
