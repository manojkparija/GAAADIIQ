import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';

interface Variant { name: string; basePrice: number; }
interface ModelEntry { variants: Variant[]; }

interface ValuationResult {
  low: number; mid: number; high: number;
  confidence: number; depreciation: number;
  marketTrend: string; tips: string[];
}

// Variant catalogue: ex-showroom base prices (₹) for popular models
const CATALOGUE: Record<string, Record<string, Variant[]>> = {
  'Maruti Suzuki': {
    'Swift':    [{ name:'LXi', basePrice:649000 }, { name:'VXi', basePrice:749000 }, { name:'ZXi', basePrice:849000 }, { name:'ZXi+', basePrice:949000 }],
    'Baleno':   [{ name:'Sigma', basePrice:669000 }, { name:'Delta', basePrice:769000 }, { name:'Zeta', basePrice:869000 }, { name:'Alpha', basePrice:969000 }],
    'Brezza':   [{ name:'LXi', basePrice:799000 }, { name:'VXi', basePrice:949000 }, { name:'ZXi', basePrice:1099000 }, { name:'ZXi+', basePrice:1299000 }],
    'Ertiga':   [{ name:'VXi', basePrice:849000 }, { name:'ZXi', basePrice:1049000 }, { name:'ZXi+', basePrice:1149000 }],
    'Ciaz':     [{ name:'Sigma', basePrice:899000 }, { name:'Delta', basePrice:999000 }, { name:'Zeta', basePrice:1099000 }, { name:'Alpha', basePrice:1199000 }],
    'Alto K10': [{ name:'STD', basePrice:349000 }, { name:'LXi', basePrice:399000 }, { name:'VXi', basePrice:449000 }],
    'WagonR':   [{ name:'LXi', basePrice:549000 }, { name:'VXi', basePrice:649000 }, { name:'ZXi', basePrice:749000 }],
  },
  'Hyundai': {
    'Creta':    [{ name:'E', basePrice:1099000 }, { name:'S', basePrice:1299000 }, { name:'S(O)', basePrice:1399000 }, { name:'SX', basePrice:1699000 }, { name:'SX(O)', basePrice:1999000 }],
    'Venue':    [{ name:'E', basePrice:799000 }, { name:'S', basePrice:949000 }, { name:'S+', basePrice:1049000 }, { name:'SX', basePrice:1249000 }, { name:'SX(O)', basePrice:1449000 }],
    'i20':      [{ name:'Magna', basePrice:749000 }, { name:'Sportz', basePrice:899000 }, { name:'Asta', basePrice:1049000 }, { name:'Asta(O)', basePrice:1149000 }],
    'Verna':    [{ name:'EX', basePrice:1099000 }, { name:'S', basePrice:1299000 }, { name:'SX', basePrice:1599000 }, { name:'SX(O)', basePrice:1799000 }],
    'Alcazar':  [{ name:'Prestige', basePrice:1699000 }, { name:'Platinum', basePrice:1999000 }, { name:'Signature', basePrice:2099000 }],
    'Tucson':   [{ name:'Platinum', basePrice:2999000 }, { name:'Signature', basePrice:3399000 }],
  },
  'Tata': {
    'Nexon':    [{ name:'Smart', basePrice:799000 }, { name:'Pure', basePrice:899000 }, { name:'Creative', basePrice:1149000 }, { name:'Fearless', basePrice:1299000 }, { name:'Fearless+', basePrice:1499000 }],
    'Punch':    [{ name:'Pure', basePrice:599000 }, { name:'Adventure', basePrice:699000 }, { name:'Accomplished', basePrice:799000 }, { name:'Creative', basePrice:899000 }],
    'Harrier':  [{ name:'Smart', basePrice:1499000 }, { name:'Pure', basePrice:1699000 }, { name:'Adventure', basePrice:1899000 }, { name:'Fearless', basePrice:2099000 }, { name:'Fearless+', basePrice:2299000 }],
    'Safari':   [{ name:'Smart', basePrice:1599000 }, { name:'Pure+', basePrice:1899000 }, { name:'Adventure+', basePrice:2099000 }, { name:'Accomplished+', basePrice:2399000 }],
    'Tigor':    [{ name:'XE', basePrice:599000 }, { name:'XM', basePrice:699000 }, { name:'XZ', basePrice:799000 }, { name:'XZ+', basePrice:899000 }],
    'Nexon EV': [{ name:'Medium Range', basePrice:1449900 }, { name:'Long Range', basePrice:1699900 }, { name:'Max LR', basePrice:1999900 }],
  },
  'Mahindra': {
    'Scorpio-N':  [{ name:'Z2', basePrice:1349000 }, { name:'Z4', basePrice:1549000 }, { name:'Z6', basePrice:1799000 }, { name:'Z8', basePrice:2099000 }, { name:'Z8 L', basePrice:2399000 }],
    'XUV700':     [{ name:'MX', basePrice:1399000 }, { name:'AX3', basePrice:1799000 }, { name:'AX5', basePrice:1999000 }, { name:'AX7', basePrice:2299000 }, { name:'AX7 L', basePrice:2599000 }],
    'Thar':       [{ name:'AX (O) STD', basePrice:1099000 }, { name:'AX (O)', basePrice:1399000 }, { name:'LX', basePrice:1599000 }],
    'XUV300':     [{ name:'W4', basePrice:799000 }, { name:'W6', basePrice:949000 }, { name:'W8', basePrice:1149000 }, { name:'W8(O)', basePrice:1249000 }],
    'Bolero':     [{ name:'B2', basePrice:949000 }, { name:'B4', basePrice:1049000 }, { name:'B6', basePrice:1099000 }],
  },
  'Honda': {
    'City':       [{ name:'SV', basePrice:1199000 }, { name:'V', basePrice:1399000 }, { name:'VX', basePrice:1549000 }, { name:'ZX', basePrice:1699000 }],
    'Amaze':      [{ name:'E', basePrice:749000 }, { name:'S', basePrice:899000 }, { name:'V', basePrice:999000 }, { name:'VX', basePrice:1099000 }],
    'Jazz':       [{ name:'V', basePrice:799000 }, { name:'VX', basePrice:899000 }, { name:'ZX', basePrice:999000 }],
    'WR-V':       [{ name:'S', basePrice:899000 }, { name:'V', basePrice:1049000 }, { name:'VX', basePrice:1149000 }],
    'Elevate':    [{ name:'SV', basePrice:1099000 }, { name:'V', basePrice:1349000 }, { name:'VX', basePrice:1549000 }, { name:'ZX', basePrice:1699000 }],
  },
  'Toyota': {
    'Innova Crysta':  [{ name:'GX', basePrice:1899000 }, { name:'VX', basePrice:2199000 }, { name:'ZX', basePrice:2499000 }],
    'Innova HyCross': [{ name:'G', basePrice:1899000 }, { name:'GX', basePrice:2199000 }, { name:'VX', basePrice:2499000 }, { name:'ZX', basePrice:2899000 }],
    'Fortuner':       [{ name:'2WD MT', basePrice:3299000 }, { name:'2WD AT', basePrice:3599000 }, { name:'4WD AT', basePrice:3999000 }, { name:'Legender', basePrice:4499000 }],
    'Glanza':         [{ name:'E', basePrice:649000 }, { name:'S', basePrice:749000 }, { name:'G', basePrice:849000 }, { name:'V', basePrice:949000 }],
    'Urban Cruiser HyRyder': [{ name:'E', basePrice:1099000 }, { name:'S', basePrice:1299000 }, { name:'G', basePrice:1499000 }, { name:'V', basePrice:1699000 }],
  },
  'Kia': {
    'Seltos':  [{ name:'HTK', basePrice:1099000 }, { name:'HTK+', basePrice:1299000 }, { name:'HTX', basePrice:1499000 }, { name:'HTX+', basePrice:1699000 }, { name:'GTX+', basePrice:1999000 }],
    'Sonet':   [{ name:'HTE', basePrice:799000 }, { name:'HTK', basePrice:949000 }, { name:'HTK+', basePrice:1099000 }, { name:'HTX', basePrice:1249000 }, { name:'GTX+', basePrice:1449000 }],
    'Carens':  [{ name:'Premium', basePrice:1099000 }, { name:'Prestige', basePrice:1299000 }, { name:'Prestige+', basePrice:1499000 }, { name:'Luxury', basePrice:1699000 }],
    'EV6':     [{ name:'GT Line RWD', basePrice:5999000 }, { name:'GT Line AWD', basePrice:6999000 }],
  },
  'MG Motor': {
    'Hector':  [{ name:'Style', basePrice:1399000 }, { name:'Super', basePrice:1599000 }, { name:'Smart', basePrice:1799000 }, { name:'Sharp', basePrice:1999000 }, { name:'Savvy', basePrice:2199000 }],
    'Astor':   [{ name:'Style', basePrice:999000 }, { name:'Super', basePrice:1199000 }, { name:'Smart', basePrice:1399000 }, { name:'Sharp', basePrice:1599000 }],
    'ZS EV':   [{ name:'Excite', basePrice:2199000 }, { name:'Exclusive', basePrice:2499000 }],
    'Gloster': [{ name:'Super', basePrice:3399000 }, { name:'Sharp', basePrice:3599000 }, { name:'Savvy', basePrice:3899000 }],
  },
  'Volkswagen': {
    'Taigun':  [{ name:'Comfortline', basePrice:1149000 }, { name:'Highline', basePrice:1399000 }, { name:'Topline', basePrice:1649000 }, { name:'GT', basePrice:1899000 }],
    'Virtus':  [{ name:'Comfortline', basePrice:1149000 }, { name:'Highline', basePrice:1349000 }, { name:'Topline', basePrice:1649000 }, { name:'GT', basePrice:1849000 }],
    'Polo':    [{ name:'Trendline', basePrice:649000 }, { name:'Comfortline', basePrice:799000 }, { name:'Highline', basePrice:899000 }, { name:'GT TSI', basePrice:999000 }],
  },
  'Skoda': {
    'Kushaq':  [{ name:'Active', basePrice:1149000 }, { name:'Ambition', basePrice:1399000 }, { name:'Style', basePrice:1699000 }, { name:'Monte Carlo', basePrice:1899000 }],
    'Slavia':  [{ name:'Active', basePrice:1149000 }, { name:'Ambition', basePrice:1349000 }, { name:'Style', basePrice:1649000 }, { name:'Monte Carlo', basePrice:1849000 }],
    'Octavia': [{ name:'Style', basePrice:2699000 }, { name:'Style Plus', basePrice:2899000 }],
    'Superb':  [{ name:'L&K', basePrice:3499000 }],
  },
  'Renault': {
    'Kwid':    [{ name:'STD', basePrice:449000 }, { name:'RXE', basePrice:549000 }, { name:'RXT', basePrice:649000 }, { name:'RXT(O)', basePrice:699000 }],
    'Triber':  [{ name:'RXE', basePrice:599000 }, { name:'RXL', basePrice:699000 }, { name:'RXT', basePrice:799000 }, { name:'RXZ', basePrice:899000 }],
    'Kiger':   [{ name:'RXE', basePrice:599000 }, { name:'RXL', basePrice:699000 }, { name:'RXT', basePrice:849000 }, { name:'RXZ', basePrice:949000 }],
  },
  'Nissan': {
    'Magnite': [{ name:'XE', basePrice:599000 }, { name:'XL', basePrice:699000 }, { name:'XV', basePrice:849000 }, { name:'XV Premium', basePrice:949000 }, { name:'Kuro', basePrice:1049000 }],
    'Kicks':   [{ name:'XL', basePrice:999000 }, { name:'XV', basePrice:1199000 }, { name:'XV Premium', basePrice:1399000 }],
  },
  'BMW': {
    '3 Series':  [{ name:'320i', basePrice:4699000 }, { name:'330i', basePrice:5499000 }, { name:'M340i', basePrice:6999000 }],
    '5 Series':  [{ name:'520i', basePrice:6499000 }, { name:'530i', basePrice:7499000 }, { name:'530d', basePrice:7999000 }],
    'X1':        [{ name:'sDrive18i', basePrice:4599000 }, { name:'xDrive20i', basePrice:5499000 }],
    'X3':        [{ name:'xDrive20i', basePrice:6999000 }, { name:'xDrive30i', basePrice:7999000 }, { name:'M Sport', basePrice:8999000 }],
    'X5':        [{ name:'xDrive40i', basePrice:9399000 }, { name:'xDrive30d', basePrice:9799000 }, { name:'M50i', basePrice:13999000 }],
  },
  'Mercedes-Benz': {
    'C-Class':  [{ name:'C 200', basePrice:5599000 }, { name:'C 220d', basePrice:5999000 }, { name:'C 300', basePrice:6799000 }],
    'E-Class':  [{ name:'E 200', basePrice:7599000 }, { name:'E 220d', basePrice:7999000 }, { name:'E 350', basePrice:9099000 }],
    'GLA':      [{ name:'200d', basePrice:4999000 }, { name:'220d', basePrice:5499000 }],
    'GLC':      [{ name:'220d', basePrice:6799000 }, { name:'300d', basePrice:7499000 }],
    'GLE':      [{ name:'300d', basePrice:9299000 }, { name:'400d', basePrice:11499000 }],
  },
  'Audi': {
    'A4':   [{ name:'Premium', basePrice:4399000 }, { name:'Premium Plus', basePrice:4899000 }, { name:'Technology', basePrice:5399000 }],
    'A6':   [{ name:'Premium', basePrice:5999000 }, { name:'Technology', basePrice:6699000 }],
    'Q3':   [{ name:'Premium', basePrice:4399000 }, { name:'Premium Plus', basePrice:4799000 }, { name:'Technology', basePrice:5299000 }],
    'Q5':   [{ name:'Premium', basePrice:5899000 }, { name:'Premium Plus', basePrice:6499000 }, { name:'Technology', basePrice:7199000 }],
    'Q7':   [{ name:'Premium', basePrice:8299000 }, { name:'Technology', basePrice:8999000 }],
  },
};

@Component({
  selector: 'app-ai-valuation',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './ai-valuation.component.html',
  styleUrl: './ai-valuation.component.scss',
})
export class AiValuationComponent {
  form = {
    make: '', model: '', variant: '', year: new Date().getFullYear(),
    km: '', fuel: '', transmission: '', owners: '', condition: '',
  };

  makes = Object.keys(CATALOGUE).concat(['Other']);
  fuels = ['Petrol','Diesel','Electric','CNG','Hybrid'];
  transmissions = ['Manual','Automatic','AMT','CVT','DCT'];
  ownerOptions = ['1st Owner','2nd Owner','3rd Owner','4th+ Owner'];
  conditions = ['Excellent','Good','Fair','Needs Work'];
  get years() { const y=[]; for(let i=new Date().getFullYear();i>=2000;i--) y.push(i); return y; }

  get availableModels(): string[] {
    return this.form.make && CATALOGUE[this.form.make] ? Object.keys(CATALOGUE[this.form.make]) : [];
  }

  get availableVariants(): Variant[] {
    if (!this.form.make || !this.form.model) return [];
    return CATALOGUE[this.form.make]?.[this.form.model] ?? [];
  }

  onMakeChange() { this.form.model = ''; this.form.variant = ''; }
  onModelChange() { this.form.variant = ''; }

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

    const age = new Date().getFullYear() - +this.form.year;
    const km = +this.form.km;

    // Use variant base price if available, else fall back to make-segment average
    const variantEntry = this.availableVariants.find(v => v.name === this.form.variant);
    const segmentFallback: Record<string, number> = {
      'BMW': 5000000, 'Mercedes-Benz': 6000000, 'Audi': 5000000,
      'Toyota': 1800000, 'Honda': 1200000, 'Hyundai': 1200000,
      'Kia': 1200000, 'MG Motor': 1500000, 'Tata': 900000,
      'Mahindra': 1200000, 'Maruti Suzuki': 750000, 'Skoda': 1500000,
      'Volkswagen': 1300000, 'Renault': 700000, 'Nissan': 800000, 'Other': 900000,
    };
    const base = variantEntry?.basePrice ?? segmentFallback[this.form.make] ?? 900000;

    // Depreciation curve: 15% yr1, 10% yr2–5, 7% yr6+
    let dep = 0;
    for (let i = 0; i < age; i++) dep += i === 0 ? 0.15 : i < 5 ? 0.10 : 0.07;
    dep = Math.min(dep, 0.75);

    // km penalty: 1% per 10k km over 20k baseline
    const kmPenalty = Math.max(0, (km - 20000) / 10000) * 0.01;

    // Owner penalty
    const ownerPenalty = this.form.owners === '1st Owner' ? 0 :
      this.form.owners === '2nd Owner' ? 0.05 :
      this.form.owners === '3rd Owner' ? 0.10 : 0.15;

    // Condition modifier
    const condMod = this.form.condition === 'Excellent' ? 1.05 :
      this.form.condition === 'Good' ? 1.0 :
      this.form.condition === 'Fair' ? 0.92 : 0.82;

    // Fuel premium
    const fuelMod = this.form.fuel === 'Electric' ? 1.08 :
      this.form.fuel === 'Hybrid' ? 1.04 : 1.0;

    const mid  = Math.round(base * (1 - dep - kmPenalty - ownerPenalty) * condMod * fuelMod / 1000) * 1000;
    const low  = Math.round(mid * 0.90 / 1000) * 1000;
    const high = Math.round(mid * 1.10 / 1000) * 1000;

    const depPct = Math.round((dep + kmPenalty + ownerPenalty) * 100);
    const trend = this.form.fuel === 'Electric' ? '📈 EVs are in strong demand right now' :
      this.form.fuel === 'Diesel' ? '📉 Diesel resale softening in metros' :
      '➡️ Petrol market is stable';

    const tips: string[] = [];
    if (km > 80000) tips.push('High mileage — a full service record will significantly boost buyer confidence.');
    if (age >= 5) tips.push('Consider a fresh paint polish and interior detailing to improve first impression.');
    if (this.form.owners !== '1st Owner') tips.push('Highlight any warranties or extended service packages in your listing.');
    if (this.form.condition !== 'Excellent') tips.push('Minor dent/scratch repairs can add ₹20–40k to your selling price.');
    if (!variantEntry) tips.push('Add the exact variant next time for a more precise estimate.');
    if (tips.length === 0 || (tips.length === 1 && !variantEntry)) tips.push('Your car is in great shape — list at the high end of the range!');

    // Higher confidence when variant is known
    const confidence = variantEntry ? 91 + Math.round(Math.random() * 6) : 78 + Math.round(Math.random() * 8);

    this.result.set({ low, mid, high, confidence, depreciation: depPct, marketTrend: trend, tips });
    this.loading.set(false);
    this.step.set('result');
  }

  reset() { this.step.set('form'); this.result.set(null); this.form = { make:'', model:'', variant:'', year: new Date().getFullYear(), km:'', fuel:'', transmission:'', owners:'', condition:'' }; }

  fmt(p: number) { return p >= 100000 ? `₹${(p/100000).toFixed(1)}L` : `₹${p.toLocaleString('en-IN')}`; }
}
