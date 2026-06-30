import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

interface Car {
  id: string;
  name: string;
  brand: string;
  price: number;
  year: number;
  km: number;
  fuel: string;
  bodyType: string;
  rating: number;
  image: string;
  features: string[];
}

@Component({
  selector: 'app-ai-advisor',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './ai-advisor.component.html',
  styleUrls: ['./ai-advisor.component.scss']
})
export class AiAdvisorComponent {
  currentStep = signal(1);
  totalSteps = 6;

  // User selections
  budget = signal<string>('');
  bodyType = signal<string>('');
  fuelType = signal<string>('');
  usage = signal<string>('');
  selectedFeatures = signal<string[]>([]);
  analyzing = signal(false);
  showResults = signal(false);

  progress = computed(() => ((this.currentStep() - 1) / (this.totalSteps - 1)) * 100);

  steps = [
    { label: 'Budget', icon: '💰' },
    { label: 'Body Type', icon: '🚗' },
    { label: 'Fuel', icon: '⛽' },
    { label: 'Usage', icon: '🛣️' },
    { label: 'Features', icon: '✨' },
    { label: 'Results', icon: '🎯' }
  ];

  budgetOptions = [
    { label: 'Under ₹5L', value: 'under-5l', range: [0, 500000] },
    { label: '₹5L – ₹10L', value: '5l-10l', range: [500000, 1000000] },
    { label: '₹10L – ₹20L', value: '10l-20l', range: [1000000, 2000000] },
    { label: '₹20L – ₹50L', value: '20l-50l', range: [2000000, 5000000] },
    { label: 'Above ₹50L', value: 'above-50l', range: [5000000, 999999999] },
  ];

  bodyTypes = ['Hatchback', 'Sedan', 'SUV', 'MUV', 'Coupe', 'Convertible'];
  fuelTypes = ['Petrol', 'Diesel', 'Electric', 'Hybrid', 'CNG'];
  usageTypes = [
    { label: 'City Commute', icon: '🏙️', value: 'city' },
    { label: 'Long Highways', icon: '🛣️', value: 'highway' },
    { label: 'Family Trips', icon: '👨‍👩‍👧', value: 'family' },
    { label: 'Off-Road', icon: '⛰️', value: 'offroad' },
  ];
  featureOptions = ['Sunroof', 'Apple CarPlay', '360° Camera', 'Ventilated Seats', 'Wireless Charging', 'ADAS', 'Heads-Up Display', 'Premium Audio'];

  featuredCars: Car[] = [
    { id: '1', name: 'Nexon EV', brand: 'Tata', price: 1450000, year: 2023, km: 12000, fuel: 'Electric', bodyType: 'SUV', rating: 4.7, image: '🚗', features: ['ADAS', 'Sunroof', 'Apple CarPlay'] },
    { id: '2', name: 'Creta', brand: 'Hyundai', price: 1650000, year: 2023, km: 8000, fuel: 'Petrol', bodyType: 'SUV', rating: 4.6, image: '🚙', features: ['Sunroof', 'Wireless Charging', '360° Camera'] },
    { id: '3', name: 'Swift', brand: 'Maruti', price: 680000, year: 2022, km: 25000, fuel: 'Petrol', bodyType: 'Hatchback', rating: 4.4, image: '🏎️', features: ['Apple CarPlay', 'Wireless Charging'] },
    { id: '4', name: 'Seltos', brand: 'Kia', price: 1800000, year: 2023, km: 5000, fuel: 'Diesel', bodyType: 'SUV', rating: 4.5, image: '🚗', features: ['Sunroof', 'ADAS', 'Premium Audio'] },
    { id: '5', name: 'City', brand: 'Honda', price: 1200000, year: 2022, km: 18000, fuel: 'Petrol', bodyType: 'Sedan', rating: 4.3, image: '🚙', features: ['Apple CarPlay', 'Wireless Charging'] },
    { id: '6', name: 'XUV 700', brand: 'Mahindra', price: 2200000, year: 2023, km: 6000, fuel: 'Diesel', bodyType: 'SUV', rating: 4.8, image: '🚘', features: ['ADAS', 'Sunroof', 'Heads-Up Display', '360° Camera'] },
  ];

  recommendations = computed(() => {
    return this.featuredCars.slice(0, 3);
  });

  selectBudget(val: string) { this.budget.set(val); }
  selectBodyType(val: string) { this.bodyType.set(val); }
  selectFuel(val: string) { this.fuelType.set(val); }
  selectUsage(val: string) { this.usage.set(val); }

  toggleFeature(feature: string) {
    this.selectedFeatures.update(features =>
      features.includes(feature)
        ? features.filter(f => f !== feature)
        : [...features, feature]
    );
  }

  isFeatureSelected(feature: string) {
    return this.selectedFeatures().includes(feature);
  }

  nextStep() {
    if (this.currentStep() < this.totalSteps) {
      this.currentStep.update(s => s + 1);
      if (this.currentStep() === 6) {
        this.analyzing.set(true);
        setTimeout(() => {
          this.analyzing.set(false);
          this.showResults.set(true);
        }, 2000);
      }
    }
  }

  prevStep() {
    if (this.currentStep() > 1) {
      this.currentStep.update(s => s - 1);
      if (this.currentStep() < 6) {
        this.showResults.set(false);
        this.analyzing.set(false);
      }
    }
  }

  reset() {
    this.currentStep.set(1);
    this.budget.set('');
    this.bodyType.set('');
    this.fuelType.set('');
    this.usage.set('');
    this.selectedFeatures.set([]);
    this.showResults.set(false);
    this.analyzing.set(false);
  }

  formatPrice(price: number) {
    if (price >= 100000) return `₹${(price / 100000).toFixed(1)}L`;
    return `₹${price.toLocaleString('en-IN')}`;
  }
}
