import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export interface ForecastYear {
  year: number;
  value: number;
  retained_pct: number;
  note?: string;
}

export interface ResaleForecast {
  forecast: ForecastYear[];
  summary: string;
  /** Which engine produced the curve — the UI must label it. */
  source: 'ai' | 'heuristic';
}

export interface ForecastInput {
  make: string;
  model: string;
  variant?: string;
  year: number;
  fuel: string;
  transmission?: string;
  /** What the car is worth today — ex-showroom for new, asking price for used. */
  price: number;
  years?: number;
}

/**
 * Projected resale value for each year of ownership.
 *
 * The local curve mirrors the API's heuristic so the Cost of Ownership tab can
 * render a full projection on first paint, with no network round-trip and no
 * spinner. The AI curve is fetched only when the user asks for it, which keeps
 * a Gemini call off every car detail view.
 */
@Injectable({ providedIn: 'root' })
export class ResaleForecastService {
  private readonly apiUrl = environment.apiUrl;

  // Kept in step with services/resale_forecast.py — same curve, same factors.
  private readonly BASE_CURVE = [0.15, 0.11, 0.10, 0.09, 0.09, 0.08, 0.08, 0.09, 0.10, 0.10];
  private readonly FUEL_FACTOR: Record<string, number> = {
    Petrol: 1.00, Diesel: 1.06, CNG: 1.10, Electric: 1.28, Hybrid: 0.94,
  };
  private readonly FLOOR_FRACTION = 0.10;

  /** The instant curve. Always available, never fails. */
  local(price: number, fuel: string, years = 5, age = 0): ForecastYear[] {
    const factor = this.FUEL_FACTOR[fuel] ?? 1.0;
    const floor = price * this.FLOOR_FRACTION;
    const out: ForecastYear[] = [];
    let value = price;
    for (let n = 1; n <= years; n++) {
      const idx = Math.min(age + n - 1, this.BASE_CURVE.length - 1);
      value = Math.max(value * (1 - this.BASE_CURVE[idx] * factor), floor);
      out.push({
        year: n,
        value: Math.round(value),
        retained_pct: price ? Math.round((value / price) * 1000) / 10 : 0,
      });
    }
    return out;
  }

  /**
   * Ask the API to refine the curve with Gemini.
   *
   * Returns null on any failure — the caller keeps showing the local curve
   * rather than replacing a working projection with an error state.
   */
  async refine(input: ForecastInput): Promise<ResaleForecast | null> {
    try {
      const resp = await fetch(`${this.apiUrl}/resale/forecast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          make: input.make || '',
          model: input.model || '',
          variant: input.variant || '',
          year: input.year,
          fuel: input.fuel || 'Petrol',
          transmission: input.transmission || '',
          price: Math.round(input.price),
          years: input.years ?? 5,
          use_ai: true,
        }),
      });
      if (!resp.ok) return null;
      const data = await resp.json() as ResaleForecast;
      return data?.forecast?.length ? data : null;
    } catch {
      return null;
    }
  }
}
