import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../components/icon/icon.component';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { SeoService } from '../../services/seo.service';
import {
  ChargerOut,
  ChargingProfile,
  EvChargingService,
  StationOut,
  StationsResponse,
} from '../../services/ev-charging.service';

/**
 * Find a charger your car can actually use (BRD §14-17).
 *
 * The list is ordinary. What is not ordinary — and what §29 says the feature
 * is for — is that every charger is assessed against the car you picked, so a
 * 120 kW post in front of a car that accepts 50 says so, in both numbers.
 *
 * NOTHING ON THIS PAGE IS FILLED IN
 *
 * When no station provider is connected the page says exactly that rather than
 * drawing an empty map that reads as "no chargers near you". A fabricated
 * station is the worst thing this feature could do: it sends someone with a
 * nearly-flat battery to a place that is not there.
 *
 * AVAILABILITY IS NOT SHOWN AS LIVE
 *
 * Open Charge Map records what a site has, not what is free now. BR-07 allows
 * a live status only where a provider supports one and AC-07 forbids showing a
 * charger as available otherwise, so the page shows "Availability not live"
 * and tells people to ring ahead.
 */
@Component({
  selector: 'app-ev-charging',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, TranslatePipe],
  templateUrl: './ev-charging.component.html',
  styleUrl: './ev-charging.component.scss',
})
export class EvChargingComponent {
  private readonly api = inject(EvChargingService);

  profiles = signal<ChargingProfile[]>([]);
  selectedProfileId = signal<string>('');

  result = signal<StationsResponse | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);
  locating = signal(false);

  radiusKm = 15;

  // Filters (§15). Applied client-side over what the API returned.
  filterCurrent = signal<'all' | 'ac' | 'dc'>('all');
  filterCompatibleOnly = signal(false);

  // The charging-time panel (§12).
  fromPct = 20;
  toPct = 80;

  constructor(seo: SeoService) {
    seo.setPage(
      'EV Charging Stations',
      'Find charging stations your electric car can actually use — connector, power and estimated charging time.',
    );
    this.loadProfiles();
  }

  async loadProfiles() {
    try {
      this.profiles.set(await this.api.profiles());
    } catch {
      // Not surfaced: the station search still works without a car selected,
      // and an error here would read as the whole page being broken.
      this.profiles.set([]);
    }
  }

  selectedProfile = computed(
    () => this.profiles().find(p => p.id === this.selectedProfileId()) ?? null,
  );

  profileLabel(p: ChargingProfile): string {
    return [p.make, p.model, p.variant].filter(Boolean).join(' ');
  }

  /** Ask the browser where we are, then search. */
  async useMyLocation() {
    if (!navigator.geolocation) {
      this.error.set('This browser cannot share your location. Please search by city instead.');
      return;
    }
    this.locating.set(true);
    this.error.set(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        this.locating.set(false);
        this.search(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        this.locating.set(false);
        this.error.set(
          'We could not get your location. Check location permission for this site, or search by city.',
        );
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  }

  async search(lat: number, lon: number) {
    this.loading.set(true);
    this.error.set(null);
    const car = this.selectedProfile();
    try {
      this.result.set(
        await this.api.stations({
          lat,
          lon,
          radiusKm: this.radiusKm,
          make: car?.make,
          model: car?.model,
          variant: car?.variant || undefined,
        }),
      );
    } catch {
      this.error.set('We could not load charging stations just now. Please try again.');
      this.result.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  /** Stations after the filters, each with its chargers filtered too. */
  visibleStations(): StationOut[] {
    const res = this.result();
    if (!res) return [];
    const current = this.filterCurrent();
    const compatOnly = this.filterCompatibleOnly();

    return res.stations
      .map(s => ({ ...s, chargers: s.chargers.filter(c => this.keep(c, current, compatOnly)) }))
      .filter(s => s.chargers.length > 0);
  }

  private keep(c: ChargerOut, current: 'all' | 'ac' | 'dc', compatOnly: boolean): boolean {
    if (current !== 'all' && c.current_type !== current) return false;
    if (compatOnly) {
      // "Not compatible" is excluded; "unknown" is kept. Hiding a charger we
      // simply lack data on would quietly shrink the map for no good reason.
      return c.compatibility !== 'not_compatible';
    }
    return true;
  }

  /**
   * Estimated session for one charger.
   *
   * A method rather than a computed(): fromPct and toPct are plain fields
   * bound with ngModel, and computed() tracks signal reads only — over a plain
   * field it evaluates once and is stale for ever. CLAUDE.md records that
   * having shipped twice.
   */
  estimateFor(c: ChargerOut): string | null {
    const car = this.selectedProfile();
    const usable = car?.usable_battery_capacity_kwh ?? car?.battery_capacity_kwh ?? null;
    const power = c.expected_max_kw ?? c.power_kw;
    if (!usable || !power || this.toPct <= this.fromPct) return null;

    // Mirrors services/ev_charging/duration.py. Kept in step deliberately:
    // the panel updates as the sliders move and a request per drag would be
    // both slow and rude to the API. The server remains the authority — the
    // /estimate endpoint uses the same constants.
    const bands: [number, number, number][] = [
      [0, 50, 0.80], [50, 80, 0.50], [80, 90, 0.28], [90, 100, 0.13],
    ];
    const span = this.toPct - this.fromPct;
    let taper = 0;
    for (const [lo, hi, f] of bands) {
      const overlap = Math.max(0, Math.min(this.toPct, hi) - Math.max(this.fromPct, lo));
      if (overlap > 0) taper += (overlap / span) * f;
    }
    const efficiency = c.current_type === 'dc' ? 0.92 : 0.88;
    const energy = usable * (span / 100);
    const minutes = (energy / (power * (taper || 1) * efficiency)) * 60;
    const low = Math.max(1, Math.round(minutes * 0.9));
    const high = Math.max(1, Math.round(minutes * 1.3));
    return `${low}–${high} min`;
  }

  compatibilityClass(c: ChargerOut): string {
    return `cmp-${c.compatibility ?? 'none'}`;
  }

  compatibilityLabel(c: ChargerOut): string {
    switch (c.compatibility) {
      case 'compatible': return 'Compatible';
      case 'limited_by_vehicle': return 'Compatible — limited by your car';
      case 'not_compatible': return 'Not compatible';
      case 'unknown': return 'Compatibility unknown';
      default: return '';
    }
  }

  currentLabel(c: ChargerOut): string {
    return c.current_type === 'dc' ? 'DC' : c.current_type === 'ac' ? 'AC' : 'AC/DC not stated';
  }

  connectorLabel(value: string): string {
    return ({
      type2: 'Type 2', ccs2: 'CCS2', chademo: 'CHAdeMO', type1: 'Type 1',
      bharat_ac_001: 'Bharat AC-001', bharat_dc_001: 'Bharat DC-001',
      three_pin: '3-pin socket', unknown: 'Connector not stated',
    } as Record<string, string>)[value] ?? value;
  }

  directionsUrl(s: StationOut): string {
    return `https://www.google.com/maps/dir/?api=1&destination=${s.latitude},${s.longitude}`;
  }
}
