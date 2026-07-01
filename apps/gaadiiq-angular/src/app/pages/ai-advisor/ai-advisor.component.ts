import { Component, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { CarsDataService, Car } from '../../services/cars-data.service';
import { SeoService } from '../../services/seo.service';

const BUDGET_MAP: Record<string, [number, number]> = {
  'Under ₹5L': [0, 500000],
  '₹5L - ₹10L': [500000, 1000000],
  '₹10L - ₹20L': [1000000, 2000000],
  '₹20L - ₹30L': [2000000, 3000000],
  'Above ₹30L': [3000000, Infinity],
};

@Component({
  selector: 'app-ai-advisor',
  standalone: true,
  imports: [RouterLink, CommonModule],
  templateUrl: './ai-advisor.component.html',
  styleUrl: './ai-advisor.component.scss'
})
export class AiAdvisorComponent {
  step = signal(0);
  matching = signal(false);
  done = signal(false);
  // Multi-select: each key maps to array of selected options
  answers = signal<Record<string, string[]>>({});

  steps = [
    { key: 'budget', title: 'What is your budget?', icon: '💰', subtitle: 'Select one or more ranges', options: ['Under ₹5L', '₹5L - ₹10L', '₹10L - ₹20L', '₹20L - ₹30L', 'Above ₹30L'], multi: false },
    { key: 'fuel', title: 'Preferred fuel type?', icon: '⛽', subtitle: 'Select all that you are open to', options: ['Petrol', 'Diesel', 'Electric', 'CNG', 'Hybrid'], multi: true },
    { key: 'usage', title: 'Primary usage?', icon: '🗺️', subtitle: 'Select all that apply', options: ['City commute', 'Long highway trips', 'Mixed city & highway', 'Off-road adventures', 'Family road trips'], multi: true },
    { key: 'bodyType', title: 'Preferred body type?', icon: '🚗', subtitle: 'Select all body types you like', options: ['Hatchback', 'Sedan', 'SUV', 'MUV', 'No preference'], multi: true },
    { key: 'transmission', title: 'Transmission preference?', icon: '⚙️', subtitle: 'Select all you are comfortable with', options: ['Manual', 'Automatic / AMT', 'No preference'], multi: true },
    { key: 'priority', title: 'What matters most to you?', icon: '✨', subtitle: 'Select all your top priorities', options: ['Fuel efficiency', 'Performance / Power', 'Safety features', 'Technology & Features', 'Resale value', 'Low maintenance'], multi: true },
  ];

  results = signal<Array<Car & { matchScore: number; reasons: string[] }>>([]);

  currentStep = computed(() => this.steps[this.step()]);
  progress = computed(() => ((this.step()) / this.steps.length) * 100);
  currentSelections = computed(() => this.answers()[this.currentStep().key] || []);
  canProceed = computed(() => this.currentSelections().length > 0);

  constructor(private carsData: CarsDataService, private seo: SeoService) {
    seo.setPage('AI Car Advisor', 'Answer 6 quick questions and let our AI recommend the perfect car from 54 verified listings.');
  }

  toggle(option: string) {
    const key = this.currentStep().key;
    const isMulti = this.currentStep().multi;
    this.answers.update(a => {
      const current = a[key] || [];
      if (!isMulti) {
        // Single select: replace
        return { ...a, [key]: [option] };
      }
      // Multi select: toggle
      if (current.includes(option)) {
        return { ...a, [key]: current.filter(o => o !== option) };
      }
      return { ...a, [key]: [...current, option] };
    });
  }

  isSelected(option: string): boolean {
    return this.currentSelections().includes(option);
  }

  next() {
    if (!this.canProceed()) return;
    if (this.step() < this.steps.length - 1) {
      this.step.update(v => v + 1);
    } else {
      this.matching.set(true);
      setTimeout(() => { this.computeResults(); this.matching.set(false); this.done.set(true); }, 2000);
    }
  }

  private has(key: string, value: string): boolean {
    return (this.answers()[key] || []).some(v => v.toLowerCase() === value.toLowerCase());
  }

  private hasAny(key: string, values: string[]): boolean {
    return values.some(v => this.has(key, v));
  }

  private computeResults() {
    const a = this.answers();
    const budgets = a['budget'] || [];
    const all = this.carsData.getAll();

    const scored = all.map(car => {
      let score = 50;
      const reasons: string[] = [];

      // Budget: match any selected range
      const inBudget = budgets.some(b => {
        const [mn, mx] = BUDGET_MAP[b] || [0, Infinity];
        return car.price >= mn && car.price <= mx;
      });
      if (inBudget) { score += 25; reasons.push(`Within budget`); }

      // Fuel match
      const fuels = a['fuel'] || [];
      if (fuels.length && !fuels.includes('Any')) {
        if (fuels.some(f => car.fuel.toLowerCase() === f.toLowerCase())) { score += 15; reasons.push(`${car.fuel} fuel`); }
        else { score -= 10; }
      }

      // Body type
      const bodyTypes = (a['bodyType'] || []).filter(b => b !== 'No preference');
      if (bodyTypes.length) {
        if (bodyTypes.some(bt => bt === 'Electric' && car.fuel === 'Electric')) { score += 15; reasons.push('Electric vehicle'); }
        else if (bodyTypes.some(bt => car.bodyType?.toLowerCase() === bt.toLowerCase())) { score += 12; reasons.push(`${car.bodyType} body`); }
      }

      // Transmission
      const transmissions = a['transmission'] || [];
      if (transmissions.length && !transmissions.includes('No preference')) {
        const wantsAuto = transmissions.some(t => t.includes('Automatic'));
        const wantsManual = transmissions.includes('Manual');
        const isAuto = !car.transmission.toLowerCase().includes('manual');
        if ((wantsAuto && isAuto) || (wantsManual && !isAuto)) { score += 8; reasons.push(`${car.transmission} gearbox`); }
      }

      // Usage hints (multi)
      const usages = a['usage'] || [];
      if (usages.includes('Off-road adventures') && car.features?.some(f => f.toLowerCase().includes('4wd'))) { score += 12; reasons.push('4WD capability'); }
      if (usages.includes('Family road trips') && (car.bodyType === 'MUV' || car.bodyType === 'SUV')) { score += 10; reasons.push('Family-friendly'); }
      if (usages.includes('City commute') && car.km < 20000) { score += 8; reasons.push('Low mileage'); }

      // Priority (multi)
      const priorities = a['priority'] || [];
      if (priorities.includes('Safety features') && car.features?.some(f => f.includes('Airbag'))) { score += 10; reasons.push('Multiple airbags'); }
      if (priorities.includes('Technology & Features') && car.features?.some(f => f.includes('ADAS'))) { score += 12; reasons.push('ADAS equipped'); }
      if (priorities.includes('Fuel efficiency')) { const m = car.specs?.find(s => s.label === 'Mileage'); if (m && parseFloat(m.value) > 20) { score += 12; reasons.push(`${m.value} mileage`); } }
      if (priorities.includes('Resale value') && ['Maruti Suzuki','Hyundai'].includes(car.make)) { score += 10; reasons.push('Strong resale brand'); }
      if (priorities.includes('Low maintenance') && ['Maruti Suzuki','Hyundai','Toyota'].includes(car.make)) { score += 8; reasons.push('Low running cost'); }
      if (priorities.includes('Performance / Power')) { const p = car.specs?.find(s => s.label === 'Power'); if (p && parseFloat(p.value) > 130) { score += 10; reasons.push(`${p.value} power`); } }

      // Rating boost
      score += (car.rating - 4) * 5;
      if (!reasons.length) reasons.push('Matches your criteria');

      return { ...car, matchScore: Math.min(score, 99), reasons: reasons.slice(0, 3) };
    });

    this.results.set(scored.sort((a, b) => b.matchScore - a.matchScore).slice(0, 5));
  }

  restart() { this.step.set(0); this.answers.set({}); this.done.set(false); this.matching.set(false); this.results.set([]); }
  formatPrice(p: number) { return `₹${(p/100000).toFixed(1)}L`; }
}
