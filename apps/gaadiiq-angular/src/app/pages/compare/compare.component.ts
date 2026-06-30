import { Component, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';

interface CompareCar {
  id: number; make: string; model: string; year: number; price: number;
  image: string; engine: string; power: string; torque: string; transmission: string;
  fuel: string; mileage: string; bootSpace: string; groundClearance: string;
  safetyRating: number; warranty: string;
}

@Component({
  selector: 'app-compare',
  standalone: true,
  imports: [RouterLink, CommonModule],
  templateUrl: './compare.component.html',
  styleUrl: './compare.component.scss'
})
export class CompareComponent {
  availableCars: CompareCar[] = [
    { id:1, make:'Hyundai', model:'Creta', year:2024, price:1450000, image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/106815/creta-exterior-right-front-three-quarter-2.jpeg', engine:'1.5L Turbo', power:'160 bhp', torque:'253 Nm', transmission:'DCT', fuel:'Petrol', mileage:'16.8 kmpl', bootSpace:'433L', groundClearance:'190mm', safetyRating:5, warranty:'3 yr/Unlimited' },
    { id:2, make:'Kia', model:'Seltos', year:2024, price:1680000, image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/115025/seltos-exterior-right-front-three-quarter-3.jpeg', engine:'1.5L Turbo', power:'160 bhp', torque:'253 Nm', transmission:'DCT', fuel:'Petrol', mileage:'16.5 kmpl', bootSpace:'433L', groundClearance:'190mm', safetyRating:4, warranty:'3 yr/Unlimited' },
    { id:3, make:'Tata', model:'Nexon', year:2024, price:950000, image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/166657/nexon-ev-exterior-right-front-three-quarter.jpeg', engine:'1.2L Turbo', power:'120 bhp', torque:'170 Nm', transmission:'AMT', fuel:'Petrol', mileage:'17.4 kmpl', bootSpace:'350L', groundClearance:'209mm', safetyRating:5, warranty:'3 yr/Unlimited' },
    { id:4, make:'Mahindra', model:'XUV700', year:2024, price:2100000, image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/42355/xuv700-exterior-right-front-three-quarter.jpeg', engine:'2.0L mStallion', power:'200 bhp', torque:'380 Nm', transmission:'Automatic', fuel:'Petrol', mileage:'14.5 kmpl', bootSpace:'604L', groundClearance:'200mm', safetyRating:5, warranty:'3 yr/100,000km' },
  ];

  selected = signal<CompareCar[]>([]);

  specRows = [
    { key: 'engine', label: 'Engine', unit: '' },
    { key: 'power', label: 'Power', unit: '' },
    { key: 'torque', label: 'Torque', unit: '' },
    { key: 'transmission', label: 'Transmission', unit: '' },
    { key: 'fuel', label: 'Fuel Type', unit: '' },
    { key: 'mileage', label: 'Mileage', unit: '' },
    { key: 'bootSpace', label: 'Boot Space', unit: '' },
    { key: 'groundClearance', label: 'Ground Clearance', unit: '' },
    { key: 'safetyRating', label: 'Safety Rating', unit: '/5' },
    { key: 'warranty', label: 'Warranty', unit: '' },
  ];

  isSelected(car: CompareCar) { return this.selected().some(c => c.id === car.id); }

  toggleCar(car: CompareCar) {
    if (this.isSelected(car)) {
      this.selected.update(arr => arr.filter(c => c.id !== car.id));
    } else if (this.selected().length < 3) {
      this.selected.update(arr => [...arr, car]);
    }
  }

  getVal(car: CompareCar, key: string): string {
    return String((car as any)[key]);
  }

  isWinner(key: string, car: CompareCar): boolean {
    const sel = this.selected();
    if (sel.length < 2) return false;
    const numericKeys = ['power', 'torque', 'mileage', 'bootSpace', 'groundClearance', 'safetyRating'];
    if (!numericKeys.includes(key)) return false;
    const vals = sel.map(c => parseFloat(String((c as any)[key])));
    const myVal = parseFloat(String((car as any)[key]));
    return myVal === Math.max(...vals);
  }

  formatPrice(p: number) { return `₹${(p/100000).toFixed(1)}L`; }
}
