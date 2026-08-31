import { Component, Output, EventEmitter, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import { CityService, POPULAR_CITIES } from '../../services/city.service';
import { NativeService } from '../../services/native.service';
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-city-selector',
  standalone: true,
  imports: [CommonModule, IconComponent, TranslatePipe],
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

  private readonly native = inject(NativeService);

  constructor(public cityService: CityService) {}

  select(city: string) {
    this.cityService.setCity(city);
    this.closed.emit();
  }

  /**
   * Set the city from where the phone actually is.
   *
   * Goes through NativeService, which asks Android for the runtime permission
   * before reading a fix. This used to call navigator.geolocation directly,
   * and inside an Android WebView that never triggers the permission request:
   * ACCESS_FINE_LOCATION is declared in the manifest, but on Android 6+
   * declaring is not granting, and nothing here asked. The failure callback
   * then reported
   *
   *     Location access denied. Please select a city manually.
   *
   * — telling the driver they had refused a permission they were never
   * offered. The same fault was fixed in marketplace.service.ts and left in
   * place here, in the EV charging map, and in the diagnosis service-centre
   * lookup; all three now share this path.
   */
  async detectLocation(): Promise<void> {
    this.locating.set(true);
    this.locationError.set('');

    let latitude: number;
    let longitude: number;
    try {
      const pos = await this.native.getCurrentPosition();
      if (!pos) throw new Error('no fix');
      latitude = pos.coords.latitude;
      longitude = pos.coords.longitude;
    } catch {
      // Reaching here on a phone now means a real refusal or no fix at all,
      // so the wording is finally true.
      this.locationError.set(
        'Could not get your location. Check that location is on for GAADIIQ, or pick a city below.',
      );
      this.locating.set(false);
      return;
    }

    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
      );
      const data = await r.json();
      const city =
        data.address?.city ||
        data.address?.town ||
        data.address?.village ||
        data.address?.county ||
        'Your Location';
      this.cityService.setCity(city);
      this.locating.set(false);
      this.closed.emit();
    } catch {
      // We know where the phone is; we just could not name the place. That is
      // a different failure from being unable to locate it, and saying so
      // stops the driver hunting through their location settings.
      this.locationError.set('Could not work out which city that is. Please select manually.');
      this.locating.set(false);
    }
  }

  onOverlayClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('modal-overlay')) {
      this.closed.emit();
    }
  }
}
