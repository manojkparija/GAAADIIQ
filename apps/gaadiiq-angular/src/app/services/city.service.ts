import { Injectable, signal } from '@angular/core';

export interface City {
  name: string;
}

// No per-city icon. These carried a landmark emoji each — 🏛️ for Mumbai, 🌊
// for Chennai, 💎 for Surat — which was decorative rather than informative, was
// drawn by the reader's operating system rather than by us, and had already
// collided: Pune and Jaipur were both 🏰. The selector now marks every city the
// same way, with one map pin, because that is the honest amount of information
// an icon adds here.
export const POPULAR_CITIES: City[] = [
  { name: 'Mumbai' },
  { name: 'Bangalore' },
  { name: 'Delhi' },
  { name: 'Pune' },
  { name: 'Navi Mumbai' },
  { name: 'Hyderabad' },
  { name: 'Ahmedabad' },
  { name: 'Chennai' },
  { name: 'Kolkata' },
  { name: 'Chandigarh' },
  { name: 'Jaipur' },
  { name: 'Surat' },
  { name: 'Bhubaneswar' },
  { name: 'Rourkela' },
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
