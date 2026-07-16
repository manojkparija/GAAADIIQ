import { Injectable, signal } from '@angular/core';

export interface City {
  name: string;
  icon: string;
}

export const POPULAR_CITIES: City[] = [
  { name: 'Mumbai',      icon: '🏛️' },
  { name: 'Bangalore',   icon: '🌆' },
  { name: 'Delhi',       icon: '🕌' },
  { name: 'Pune',        icon: '🏰' },
  { name: 'Navi Mumbai', icon: '🌃' },
  { name: 'Hyderabad',   icon: '🕍' },
  { name: 'Ahmedabad',   icon: '🏯' },
  { name: 'Chennai',     icon: '🌊' },
  { name: 'Kolkata',     icon: '🌉' },
  { name: 'Chandigarh',  icon: '🌸' },
  { name: 'Jaipur',       icon: '🏰' },
  { name: 'Surat',        icon: '💎' },
  { name: 'Bhubaneswar',  icon: '🛕' },
  { name: 'Rourkela',     icon: '⚙️' },
];

@Injectable({ providedIn: 'root' })
export class CityService {
  readonly selectedCity = signal<string>(
    localStorage.getItem('gaadiiq_city') ?? ''
  );

  setCity(city: string) {
    this.selectedCity.set(city);
    localStorage.setItem('gaadiiq_city', city);
  }

  clearCity() {
    this.selectedCity.set('');
    localStorage.removeItem('gaadiiq_city');
  }
}
