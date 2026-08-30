import { Injectable, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { SupabaseService } from './supabase.service';

/** A car that has been announced but is not on sale yet. */
export interface UpcomingCar {
  id: string;
  make: string;
  model: string;
  /** The last day of the announced window, as a date the API can compare. */
  expected_on: string;
  /** "Q3 2026", derived by the API from expected_on. Never stored as prose. */
  expected_quarter: string;
  expected_price_min: string | number | null;
  expected_price_max: string | number | null;
  body_type: string | null;
  fuel_type: string | null;
  image_url: string | null;
  launched_at: string | null;
  is_active: boolean;
}

/**
 * The Upcoming Cars strip, from the API rather than from a literal.
 *
 * It was a hardcoded array of five entries inside the New Cars component, with
 * the expected date as free text and nothing that ever removed one — so a car
 * stayed under "Upcoming" after it launched, and correcting that took a
 * deploy. Four of the five were on sale by the time it was reported.
 *
 * Which cars are still upcoming is decided by the API, not here: it is the
 * same question for every caller, and a page that has to remember to ask it is
 * a page that will one day forget.
 */
@Injectable({ providedIn: 'root' })
export class UpcomingCarsService {
  private supabase = inject(SupabaseService);
  private apiUrl = environment.apiUrl;

  readonly cars = signal<UpcomingCar[]>([]);
  readonly loading = signal(false);
  /**
   * True when the fetch failed, as distinct from there being nothing to show.
   *
   * The two look identical on screen — an empty strip — and they mean opposite
   * things: "no launches announced" versus "we could not ask".
   */
  readonly failed = signal(false);

  private async authHeaders(): Promise<Record<string, string>> {
    const { data } = await this.supabase.client.auth.getSession();
    const token = data.session?.access_token ?? '';
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /** @param includePast admin screens pass true to see retired rows too. */
  async load(includePast = false): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    try {
      const url = `${this.apiUrl}/upcoming-cars${includePast ? '?include_past=true' : ''}`;
      const resp = await fetch(url, { headers: await this.authHeaders() });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this.cars.set(await resp.json());
    } catch {
      this.failed.set(true);
      this.cars.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  async create(body: Partial<UpcomingCar>): Promise<void> {
    await this.send('POST', '', body);
  }

  async update(id: string, body: Record<string, unknown>): Promise<void> {
    await this.send('PATCH', `/${id}`, body);
  }

  async remove(id: string): Promise<void> {
    await this.send('DELETE', `/${id}`);
  }

  /**
   * One place that reads the API's own message on failure.
   *
   * `HTTP 500` tells an admin nothing they can act on; FastAPI puts the reason
   * in `detail`, and a validation error names the field.
   */
  private async send(method: string, path: string, body?: unknown): Promise<void> {
    const resp = await fetch(`${this.apiUrl}/upcoming-cars${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(await this.authHeaders()) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!resp.ok) {
      let detail = `HTTP ${resp.status} ${resp.statusText}`.trim();
      try {
        const parsed = await resp.json();
        if (parsed?.detail) detail = typeof parsed.detail === 'string'
          ? parsed.detail
          : JSON.stringify(parsed.detail);
      } catch { /* not JSON — a gateway page, most likely */ }
      throw new Error(detail);
    }
  }
}
