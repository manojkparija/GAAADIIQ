import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CustomSelectComponent, SelectOption } from '../../components/custom-select/custom-select.component';
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

/** Sentinel for the "not listed" row — no real profile id can collide with it. */
const MANUAL = '__manual__';

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
  imports: [CommonModule, FormsModule, CustomSelectComponent, IconComponent, TranslatePipe],
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

  radiusKm = '15 km';

  /**
   * Native <select> was replaced by app-custom-select.
   *
   * Not cosmetics. A native option list is painted by the operating system —
   * the highlight is the OS accent colour, not ours, and no amount of CSS
   * reaches inside it. On this page that meant a stock blue bar in the middle
   * of a blue-teal design, and it looks like a bug rather than a default.
   */
  readonly radiusOptions = ['5 km', '15 km', '30 km', '50 km'];

  private radiusValue(): number {
    return parseInt(this.radiusKm, 10) || 15;
  }

  /**
   * The car picker's options.
   *
   * Always carries the manual entry row, so the page is usable before anybody
   * has entered a single profile. An empty dropdown reads as broken; an empty
   * dropdown on a page whose whole promise is "tell me if my car fits" reads
   * as broken AND useless.
   */
  carOptions(): SelectOption[] {
    // No explicit '' row: app-custom-select renders its own placeholder option
    // which selects '', and adding one here would show it twice.
    return [
      ...this.profiles().map(p => ({ value: p.id, label: this.profileLabel(p) })),
      { value: MANUAL, label: 'My car is not listed — enter its figures' },
    ];
  }

  /** True when the driver is typing their own car's specification. */
  manual = signal(false);
  manualAcKw: number | null = 7.2;
  manualDcKw: number | null = 50;
  manualUsableKwh: number | null = null;
  manualDcConnector = 'ccs2';

  onCarChange(value: string) {
    this.manual.set(value === MANUAL);
    this.selectedProfileId.set(value === MANUAL ? '' : value);
  }

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

  /**
   * The specification in force: a saved profile, or what the driver typed.
   *
   * A method rather than a computed(): the manual fields are plain and bound
   * with ngModel, and computed() tracks signal reads only — over a plain field
   * it evaluates once and is stale for ever. CLAUDE.md records that having
   * shipped twice.
   */
  activeSpec(): { usableKwh: number | null; acKw: number | null; dcKw: number | null } | null {
    if (this.manual()) {
      return {
        usableKwh: this.manualUsableKwh,
        acKw: this.manualAcKw,
        dcKw: this.manualDcKw,
      };
    }
    const p = this.selectedProfile();
    if (!p) return null;
    return {
      usableKwh: p.usable_battery_capacity_kwh ?? p.battery_capacity_kwh,
      acKw: p.max_ac_kw,
      dcKw: p.max_dc_kw,
    };
  }

  profileLabel(p: ChargingProfile): string {
    return [p.make, p.model, p.variant].filter(Boolean).join(' ');
  }

  /**
   * How precise the last fix was, in metres, and whether that is good enough.
   *
   * Surfaced rather than swallowed. A browser can return a position derived
   * from the IP address that is kilometres out, and it is indistinguishable
   * from a GPS fix unless you read `accuracy` — so "2.4 km away" gets printed
   * against a centre that is in the wrong part of the city.
   */
  accuracyM = signal<number | null>(null);

  /** Beyond this the fix is a network or IP guess, not a real position. */
  private static readonly POOR_ACCURACY_M = 2000;

  poorAccuracy(): boolean {
    const a = this.accuracyM();
    return a !== null && a > EvChargingComponent.POOR_ACCURACY_M;
  }

  cityQuery = '';
  cityLookup = signal(false);

  /**
   * Ask the browser where we are, then search.
   *
   * enableHighAccuracy: true is the important one. Without it the browser
   * answers from Wi-Fi and network positioning, which in Indian cities is
   * routinely 1-5 km out; with it a phone uses GPS and lands within tens of
   * metres. For a feature whose whole job is "drive to this specific charger",
   * a three-kilometre error picks the wrong charger.
   *
   * maximumAge: 0 because somebody who has just tapped "near me" has usually
   * moved — a minute-old cached fix is exactly the case this button exists to
   * refresh. The longer timeout is the cost of asking for GPS: a cold fix
   * takes noticeably longer than reading a cached network position.
   */
  async useMyLocation() {
    if (!navigator.geolocation) {
      this.error.set(
        'This browser cannot share your location. Enter your city instead.',
      );
      return;
    }
    this.locating.set(true);
    this.error.set(null);
    this.accuracyM.set(null);

    navigator.geolocation.getCurrentPosition(
      pos => {
        this.locating.set(false);
        this.accuracyM.set(Math.round(pos.coords.accuracy));
        this.searchedCity.set(null);
        this.search(pos.coords.latitude, pos.coords.longitude);
      },
      err => {
        this.locating.set(false);
        // Distinguished, because the remedy differs: a refusal needs a browser
        // setting changed, a timeout just needs trying again or going outside,
        // and "unavailable" usually means no GPS and no network fix at all.
        this.error.set(
          err.code === err.PERMISSION_DENIED
            ? 'Location is blocked for this site. Allow it in your browser settings, or enter your city below.'
            : err.code === err.TIMEOUT
              ? 'Getting a GPS fix took too long. Try again near a window, or enter your city below.'
              : 'Your device could not work out where it is. Please enter your city below.',
        );
      },
      // See the docstring: high accuracy, no cached fix, and enough time for
      // GPS to actually acquire.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  /**
   * Search around a named city, when the device cannot place itself.
   *
   * Geocoded through Nominatim, which the city selector in the navbar already
   * uses for the reverse direction — so this is the same third party the app
   * has already accepted rather than a new one. A city centre is a coarse
   * origin and the page says so: distances are "from the centre of Kolkata",
   * not "from you".
   */
  async searchByCity() {
    const q = this.cityQuery.trim();
    if (q.length < 3) {
      this.error.set('Please type at least three letters of a city name.');
      return;
    }
    this.cityLookup.set(true);
    this.error.set(null);
    try {
      const url =
        'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=' +
        encodeURIComponent(q);
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const hits = (await res.json()) as { lat: string; lon: string }[];
      if (!hits.length) {
        this.error.set(`We could not find "${q}". Try a larger nearby city.`);
        return;
      }
      // A city centre, not a device position — recorded as such so the page
      // can label the distances honestly rather than implying a GPS fix.
      this.accuracyM.set(null);
      this.searchedCity.set(q);
      await this.search(parseFloat(hits[0].lat), parseFloat(hits[0].lon));
    } catch {
      this.error.set('We could not look up that city just now. Please try again.');
    } finally {
      this.cityLookup.set(false);
    }
  }

  /** Set when the origin is a city centre rather than the device. */
  searchedCity = signal<string | null>(null);

  async search(lat: number, lon: number) {
    this.loading.set(true);
    this.error.set(null);
    const car = this.selectedProfile();
    try {
      this.result.set(
        await this.api.stations({
          lat,
          lon,
          radiusKm: this.radiusValue(),
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
    const spec = this.activeSpec();
    const usable = spec?.usableKwh ?? null;

    // min(charger, car) — the whole point. Estimating from the station's
    // advertised figure is the misleading-number bug in its most damaging
    // form: a specific, confident, far-too-short time.
    const carLimit = c.current_type === 'dc' ? spec?.dcKw : spec?.acKw;
    const stationKw = c.expected_max_kw ?? c.power_kw;
    const power = carLimit != null && stationKw != null
      ? Math.min(carLimit, stationKw)
      : stationKw;

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
