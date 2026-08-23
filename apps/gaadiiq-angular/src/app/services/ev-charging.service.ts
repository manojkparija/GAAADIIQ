import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type Compatibility = 'compatible' | 'limited_by_vehicle' | 'not_compatible' | 'unknown';
export type SpeedCategory =
  | 'slow' | 'normal' | 'fast' | 'high_speed' | 'ultra_fast' | 'unknown';

export interface ChargerOut {
  id: string | null;
  connector_type: string;
  current_type: 'ac' | 'dc' | 'unknown';
  /** BR-03: always shown, never replaced by the category. */
  power_kw: number | null;
  speed_category: SpeedCategory;
  speed_label: string;
  total_ports: number | null;
  status: string;
  /** False for every provider we currently have. See the page's notice. */
  live_availability: boolean;
  compatibility: Compatibility | null;
  compatibility_message: string | null;
  expected_max_kw: number | null;
  vehicle_max_kw: number | null;
}

export interface StationOut {
  id: string | null;
  name: string;
  operator_name: string | null;
  address: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  status: string;
  distance_km: number | null;
  price_per_kwh: number | null;
  chargers: ChargerOut[];
  source: string;
  source_url: string | null;
  last_updated: string | null;
  data_confidence: number | null;
}

export interface StationsResponse {
  stations: StationOut[];
  provider_configured: boolean;
  provider: string | null;
  live_availability: boolean;
  notice: string | null;
}

export interface ChargingProfile {
  id: string;
  make: string;
  model: string;
  variant: string;
  battery_capacity_kwh: number | null;
  usable_battery_capacity_kwh: number | null;
  ac_connector: string | null;
  max_ac_kw: number | null;
  dc_connector: string | null;
  max_dc_kw: number | null;
  source_note: string | null;
}

export interface EstimateOut {
  energy_needed_kwh: number;
  minutes_low: number;
  minutes_high: number;
  assumed_kw: number;
  includes_taper_zone: boolean;
  summary: string;
}

/**
 * EV charging stations and the intelligence around them.
 *
 * Everything comes from GAADIIQ's own API. The station provider's key stays
 * server-side — a key in this bundle is public the moment it ships — and the
 * compatibility maths runs there too, so the browser cannot be talked into
 * reporting a charger as usable when it is not.
 *
 * NOTE no Authorization header is set here. interceptors/auth.interceptor
 * attaches the Supabase token to anything aimed at environment.apiUrl, and
 * setting one by hand shadows it.
 */
@Injectable({ providedIn: 'root' })
export class EvChargingService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/ev-charging`;

  readonly loading = signal(false);

  /**
   * Stations near a point, each charger assessed against the chosen car.
   *
   * The vehicle is passed as make/model rather than a catalogue id: charging
   * profiles are keyed by name so they survive a catalogue re-import.
   */
  async stations(opts: {
    lat: number;
    lon: number;
    radiusKm?: number;
    make?: string;
    model?: string;
    variant?: string;
  }): Promise<StationsResponse> {
    let params = new HttpParams()
      .set('lat', String(opts.lat))
      .set('lon', String(opts.lon))
      .set('radius_km', String(opts.radiusKm ?? 15));
    if (opts.make) params = params.set('make', opts.make);
    if (opts.model) params = params.set('model', opts.model);
    if (opts.variant) params = params.set('variant', opts.variant);

    this.loading.set(true);
    try {
      return await firstValueFrom(
        this.http.get<StationsResponse>(`${this.base}/stations`, { params }),
      );
    } finally {
      this.loading.set(false);
    }
  }

  /** Cars we hold charging specifications for. */
  profiles(): Promise<ChargingProfile[]> {
    return firstValueFrom(this.http.get<ChargingProfile[]>(`${this.base}/profiles`));
  }

  estimate(body: {
    usable_capacity_kwh: number;
    from_pct: number;
    to_pct: number;
    charger_kw: number;
    vehicle_max_kw?: number | null;
    is_dc: boolean;
  }): Promise<EstimateOut> {
    return firstValueFrom(this.http.post<EstimateOut>(`${this.base}/estimate`, body));
  }

  report(station_id: string, issue: string, detail = ''): Promise<unknown> {
    return firstValueFrom(this.http.post(`${this.base}/report`, { station_id, issue, detail }));
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  adminProfiles(): Promise<ChargingProfile[]> {
    return firstValueFrom(this.http.get<ChargingProfile[]>(`${this.base}/admin/profiles`));
  }

  saveProfile(body: Partial<ChargingProfile>): Promise<ChargingProfile> {
    return firstValueFrom(
      this.http.post<ChargingProfile>(`${this.base}/admin/profiles`, body),
    );
  }
}
