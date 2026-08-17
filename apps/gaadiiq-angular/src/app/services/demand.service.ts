import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';

/**
 * Reads the demand instrumentation.
 *
 * Every response can come back saying it has no answer yet — `has_enough_data`
 * false, with a `note` explaining why. That is a normal response, not an
 * error: a new marketplace genuinely has no traffic, and the UI is expected to
 * print the note rather than render a zero as though it were a measurement.
 *
 * No Authorization header is set here. The interceptor attaches it, and one
 * set by hand shadows it.
 */

export interface ListingActivity {
  views_24h: number;
  views_7d: number;
  unique_viewers_7d: number;
  days_on_market: number;
  has_enough_data: boolean;
  note: string | null;
}

export interface DaysTurn {
  median_days: number | null;
  sample_size: number;
  has_enough_data: boolean;
  note: string | null;
  basis: string;
}

export interface DemandCell {
  city: string;
  searches: number;
  empty_searches: number;
}

export interface DemandMap {
  cells: DemandCell[];
  window_days: number;
  total_searches: number;
  has_enough_data: boolean;
  note: string | null;
}

export interface InventoryGap {
  make: string | null;
  model: string | null;
  searches: number;
  empty_searches: number;
  listings_available: number;
}

export interface InventoryGapReport {
  gaps: InventoryGap[];
  window_days: number;
  has_enough_data: boolean;
  note: string | null;
}

@Injectable({ providedIn: 'root' })
export class DemandService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/demand`;

  /**
   * Activity on one listing. Null when the API is unreachable.
   *
   * Distinguished from "not enough data": that comes back as a real response
   * with has_enough_data false. Null means we do not know, and the card is not
   * rendered at all rather than claiming a quiet car.
   */
  async activity(listingId: string): Promise<ListingActivity | null> {
    try {
      return await firstValueFrom(
        this.http.get<ListingActivity>(`${this.base}/listings/${listingId}/activity`),
      );
    } catch {
      return null;
    }
  }

  async daysTurn(mine = false): Promise<DaysTurn | null> {
    try {
      return await firstValueFrom(
        this.http.get<DaysTurn>(`${this.base}/days-turn`, { params: { mine } }),
      );
    } catch {
      return null;
    }
  }

  async map(city?: string): Promise<DemandMap | null> {
    try {
      return await firstValueFrom(
        this.http.get<DemandMap>(`${this.base}/map`, { params: city ? { city } : {} }),
      );
    } catch {
      return null;
    }
  }

  async inventoryGaps(city?: string): Promise<InventoryGapReport | null> {
    try {
      return await firstValueFrom(
        this.http.get<InventoryGapReport>(
          `${this.base}/inventory-gaps`,
          { params: city ? { city } : {} },
        ),
      );
    } catch {
      return null;
    }
  }
}
