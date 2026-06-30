import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

interface Car {
  id: string;
  brand: string;
  name: string;
  price: number;
  year: number;
  km: number;
  fuel: string;
  transmission: string;
  rating: number;
  bodyType: string;
  engine: string;
  mileage: string;
  seats: number;
  image: string;
}

@Component({
  selector: 'app-compare',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './compare.component.html',
  styleUrls: ['./compare.component.scss']
})
export class CompareComponent {
  allCars: Car[] = [
    { id: '1', brand: 'Tata', name: 'Nexon EV', price: 1450000, year: 2023, km: 12000, fuel: 'Electric', transmission: 'Automatic', rating: 4.7, bodyType: 'SUV', engine: 'Electric Motor', mileage: '312 km range', seats: 5, image: '🚗' },
    { id: '2', brand: 'Hyundai', name: 'Creta', price: 1650000, year: 2023, km: 8000, fuel: 'Petrol', transmission: 'Automatic', rating: 4.6, bodyType: 'SUV', engine: '1.5L Turbo', mileage: '16.8 kmpl', seats: 5, image: '🚙' },
    { id: '3', brand: 'Maruti', name: 'Swift', price: 680000, year: 2022, km: 25000, fuel: 'Petrol', transmission: 'Manual', rating: 4.4, bodyType: 'Hatchback', engine: '1.2L Dual VVT', mileage: '23.2 kmpl', seats: 5, image: '🏎️' },
    { id: '4', brand: 'Kia', name: 'Seltos', price: 1800000, year: 2023, km: 5000, fuel: 'Diesel', transmission: 'Automatic', rating: 4.5, bodyType: 'SUV', engine: '1.5L CRDi', mileage: '21.0 kmpl', seats: 5, image: '🚗' },
    { id: '5', brand: 'Honda', name: 'City', price: 1200000, year: 2022, km: 18000, fuel: 'Petrol', transmission: 'CVT', rating: 4.3, bodyType: 'Sedan', engine: '1.5L VTEC', mileage: '17.8 kmpl', seats: 5, image: '🚙' },
    { id: '6', brand: 'Mahindra', name: 'XUV 700', price: 2200000, year: 2023, km: 6000, fuel: 'Diesel', transmission: 'Automatic', rating: 4.8, bodyType: 'SUV', engine: '2.2L mHawk', mileage: '16.3 kmpl', seats: 7, image: '🚘' },
  ];

  selectedIds = signal<string[]>([]);

  selectedCars = computed(() =>
    this.allCars.filter(c => this.selectedIds().includes(c.id))
  );

  canAddMore = computed(() => this.selectedIds().length < 3);

  toggleCar(id: string) {
    this.selectedIds.update(ids => {
      if (ids.includes(id)) return ids.filter(i => i !== id);
      if (ids.length >= 3) return ids;
      return [...ids, id];
    });
  }

  isSelected(id: string) {
    return this.selectedIds().includes(id);
  }

  formatPrice(price: number) {
    if (price >= 100000) return `₹${(price / 100000).toFixed(1)}L`;
    return `₹${price.toLocaleString('en-IN')}`;
  }

  getBest(field: keyof Car, prefer: 'min' | 'max'): string {
    const cars = this.selectedCars();
    if (cars.length < 2) return '';
    const values = cars.map(c => c[field] as number);
    const best = prefer === 'min' ? Math.min(...values) : Math.max(...values);
    const bestCar = cars.find(c => c[field] === best);
    return bestCar ? bestCar.id : '';
  }

  isBest(car: Car, field: keyof Car, prefer: 'min' | 'max'): boolean {
    const cars = this.selectedCars();
    if (cars.length < 2) return false;
    const values = cars.map(c => c[field] as number);
    const best = prefer === 'min' ? Math.min(...values) : Math.max(...values);
    return car[field] === best;
  }

  comparisonRows: { label: string; field: keyof Car; prefer: 'min' | 'max'; format?: (v: any) => string }[] = [
    { label: 'Price', field: 'price', prefer: 'min', format: v => this.formatPrice(v) },
    { label: 'Year', field: 'year', prefer: 'max' },
    { label: 'KM Driven', field: 'km', prefer: 'min', format: v => `${v.toLocaleString('en-IN')} km` },
    { label: 'Fuel Type', field: 'fuel', prefer: 'max' },
    { label: 'Transmission', field: 'transmission', prefer: 'max' },
    { label: 'Mileage', field: 'mileage', prefer: 'max' },
    { label: 'Engine', field: 'engine', prefer: 'max' },
    { label: 'Seats', field: 'seats', prefer: 'max' },
    { label: 'Rating', field: 'rating', prefer: 'max', format: v => `⭐ ${v}` },
  ];
}
