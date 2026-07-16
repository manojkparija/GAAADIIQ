import { Component, Output, EventEmitter, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import { CityService, POPULAR_CITIES } from '../../services/city.service';

@Component({
  selector: 'app-city-selector',
  standalone: true,
  imports: [CommonModule, IconComponent],
  templateUrl: './city-selector.component.html',
  styleUrl: './city-selector.component.scss',
})
export class CitySelectorComponent {
  @Output() closed = new EventEmitter<void>();

  readonly popularCities = POPULAR_CITIES;
  searchQuery = signal('');
  locating = signal(false);
  locationError = signal('');

  filteredCities = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.popularCities;
    return this.popularCities.filter(c => c.name.toLowerCase().includes(q));
  });

  constructor(public cityService: CityService) {}

  select(city: string) {
    this.cityService.setCity(city);
    this.closed.emit();
  }

  detectLocation() {
    if (!navigator.geolocation) {
      this.locationError.set('Geolocation is not supported by your browser.');
      return;
    }
    this.locating.set(true);
    this.locationError.set('');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`)
          .then(r => r.json())
          .then(data => {
            const city =
              data.address?.city ||
              data.address?.town ||
              data.address?.village ||
              data.address?.county ||
              'Your Location';
            this.cityService.setCity(city);
            this.locating.set(false);
            this.closed.emit();
          })
          .catch(() => {
            this.locationError.set('Could not determine your city. Please select manually.');
            this.locating.set(false);
          });
      },
      () => {
        this.locationError.set('Location access denied. Please select a city manually.');
        this.locating.set(false);
      }
    );
  }

  onOverlayClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      this.closed.emit();
    }
  }
}
