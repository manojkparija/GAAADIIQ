import { Component, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';

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
    {
      key: 'budget', title: 'What is your budget?', icon: '💰',
      options: ['Under ₹5L', '₹5L - ₹10L', '₹10L - ₹20L', '₹20L - ₹30L', 'Above ₹30L']
    },
    {
      key: 'fuel', title: 'Preferred fuel type?', icon: '⛽',
      options: ['Petrol', 'Diesel', 'Electric', 'CNG', 'Hybrid', 'Any']
    },
    {
      key: 'usage', title: 'Primary usage?', icon: '🗺',
      options: ['City commute', 'Long highway trips', 'Mixed city & highway', 'Off-road adventures', 'Family road trips']
    },
    {
      key: 'seating', title: 'How many seats?', icon: '💺',
      options: ['4 seater', '5 seater', '6-7 seater', '8+ seater']
    },
    {
      key: 'bodyType', title: 'Preferred body type?', icon: '🚗',
      options: ['Hatchback', 'Sedan', 'SUV', 'MUV', 'Coupe', 'No preference']
    },
    {
      key: 'features', title: 'Must-have features?', icon: '✨',
      options: ['Sunroof', 'ADAS / Safety', 'Large touchscreen', 'Wireless charging', 'Ventilated seats', 'EV range 400km+']
    }
  ];

  results = [
    { make: 'Hyundai', model: 'Creta', year: 2024, price: '₹11.5L', match: 98, badge: '🏆 Best Match', image: 'https://imgd.aeplcdn.com/1200x900/n/cw/ec/106815/creta-exterior-right-front-three-quarter-2.jpeg' },
    { make: 'Kia', model: 'Seltos', year: 2024, price: '₹10.9L', match: 94, badge: '⭐ Top Pick', image: 'https://imgd.aeplcdn.com/1200x900/n/cw/ec/115025/seltos-exterior-right-front-three-quarter-3.jpeg' },
    { make: 'Tata', model: 'Nexon', year: 2024, price: '₹8.5L', match: 89, badge: '💰 Best Value', image: 'https://imgd.aeplcdn.com/1200x900/n/cw/ec/166657/nexon-ev-exterior-right-front-three-quarter.jpeg' },
  ];

  currentStep = computed(() => this.steps[this.step()]);
  progress = computed(() => ((this.step()) / this.steps.length) * 100);

  select(option: string) {
    this.answers.update(a => ({ ...a, [this.currentStep().key]: option }));
    if (this.step() < this.steps.length - 1) {
      this.step.update(v => v + 1);
    } else {
      this.matching.set(true);
      setTimeout(() => {
        this.matching.set(false);
        this.done.set(true);
      }, 3000);
    }
  }

  restart() {
    this.step.set(0);
    this.answers.set({});
    this.done.set(false);
    this.matching.set(false);
  }
}
