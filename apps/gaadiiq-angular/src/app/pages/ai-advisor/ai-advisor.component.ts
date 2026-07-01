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
  answers = signal<Record<string, string>>({});

  steps = [
    { key: 'budget', title: 'What is your budget?', icon: '💰', subtitle: 'We\'ll filter listings to match', options: ['Under ₹5L', '₹5L - ₹10L', '₹10L - ₹20L', '₹20L - ₹30L', 'Above ₹30L'] },
    { key: 'fuel', title: 'Preferred fuel type?', icon: '⛽', subtitle: 'Affects running cost significantly', options: ['Petrol', 'Diesel', 'Electric', 'CNG', 'Hybrid', 'Any'] },
    { key: 'usage', title: 'Primary usage?', icon: '🗺️', subtitle: 'Helps match the right body type', options: ['City commute', 'Long highway trips', 'Mixed city & highway', 'Off-road adventures', 'Family road trips'] },
    { key: 'bodyType', title: 'Preferred body type?', icon: '🚗', subtitle: 'Style meets practicality', options: ['Hatchback', 'Sedan', 'SUV', 'MUV', 'Electric', 'No preference'] },
    { key: 'transmission', title: 'Transmission preference?', icon: '⚙️', subtitle: 'Automatic is easier in city traffic', options: ['Manual', 'Automatic / AMT', 'No preference'] },
    { key: 'priority', title: 'What matters most to you?', icon: '✨', subtitle: 'Your top buying priority', options: ['Fuel efficiency', 'Performance / Power', 'Safety features', 'Technology & Features', 'Resale value', 'Low maintenance'] },
  ];

  results = signal<Array<Car & { matchScore: number; reasons: string[] }>>([]);

  currentStep = computed(() => this.steps[this.step()]);
  progress = computed(() => ((this.step()) / this.steps.length) * 100);

  constructor(private carsData: CarsDataService, private seo: SeoService) {
    seo.setPage('AI Car Advisor', 'Answer 6 quick questions and let our AI recommend the perfect car from 54 verified listings.');
  }

  select(option: string) {
    this.answers.update(a => ({ ...a, [this.currentStep().key]: option }));
    if (this.step() < this.steps.length - 1) {
      this.step.update(v => v + 1);
    } else {
      this.matching.set(true);
      setTimeout(() => { this.computeResults(); this.matching.set(false); this.done.set(true); }, 2000);
    }
  }

  private computeResults() {
    const a = this.answers();
    const [minB, maxB] = BUDGET_MAP[a['budget']] || [0, Infinity];
    const all = this.carsData.getAll();

    const scored = all.map(car => {
      let score = 50;
      const reasons: string[] = [];

      // Budget match
      if (car.price >= minB && car.price <= maxB) { score += 25; reasons.push(`Within ${a['budget']} budget`); }
      else if (car.price < minB * 1.15) { score += 10; }

      // Fuel match
      if (a['fuel'] !== 'Any') {
        if (car.fuel.toLowerCase() === a['fuel'].toLowerCase()) { score += 15; reasons.push(`${car.fuel} fuel`); }
        else { score -= 10; }
      }

      // Body type
      if (a['bodyType'] !== 'No preference') {
        const bt = a['bodyType'] === 'Electric' ? 'Electric' : a['bodyType'];
        if (a['bodyType'] === 'Electric' && car.fuel === 'Electric') { score += 15; reasons.push('Electric vehicle'); }
        else if (car.bodyType?.toLowerCase() === bt.toLowerCase()) { score += 12; reasons.push(`${car.bodyType} body`); }
      }

      // Transmission
      if (a['transmission'] !== 'No preference') {
        const wantsAuto = a['transmission'].includes('Automatic');
        const isAuto = !car.transmission.toLowerCase().includes('manual');
        if (wantsAuto === isAuto) { score += 8; reasons.push(`${car.transmission} gearbox`); }
      }

      // Usage hints
      if (a['usage'] === 'Off-road adventures' && car.features?.some(f => f.toLowerCase().includes('4wd'))) { score += 12; reasons.push('4WD capability'); }
      if (a['usage'] === 'Family road trips' && (car.bodyType === 'MUV' || car.bodyType === 'SUV')) { score += 10; reasons.push('Family-friendly space'); }
      if (a['usage'] === 'City commute' && car.km < 20000) { score += 8; reasons.push('Low mileage'); }

      // Priority
      if (a['priority'] === 'Safety features' && car.features?.some(f => f.includes('Airbag'))) { score += 10; reasons.push('Multiple airbags'); }
      if (a['priority'] === 'Technology & Features' && car.features?.some(f => f.includes('ADAS'))) { score += 12; reasons.push('ADAS equipped'); }
      if (a['priority'] === 'Fuel efficiency') { const m = car.specs?.find(s => s.label === 'Mileage'); if (m && parseFloat(m.value) > 20) { score += 12; reasons.push(`${m.value} mileage`); } }
      if (a['priority'] === 'Resale value' && ['Maruti Suzuki','Hyundai'].includes(car.make)) { score += 10; reasons.push('Strong resale brand'); }

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
