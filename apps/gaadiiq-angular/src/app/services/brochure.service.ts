import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * One image extracted from a manufacturer brochure PDF.
 *
 * `url` is derived server-side from the storage key, so it keeps working when
 * the backend moves from local disk to S3 — nothing here needs to change.
 */
export interface BrochureImage {
  id: string;
  url: string;
  /**
   * Null when thumbnail generation failed on an image the decoder disliked.
   * Callers fall back to `url` rather than rendering a broken image.
   */
  thumbnail_url?: string | null;
  content_type: string;
  width?: number | null;
  height?: number | null;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  colour?: string | null;
  model_year?: number | null;
  category?: string | null;
  kind?: string;
  view?: string;
  source_pdf_name: string;
  page_number?: number | null;
  created_at: string;
}

/**
 * What a surface is asking for. Every field is optional: a brand page filters
 * on make alone, a variant page on make+model+variant, a colour picker on
 * make+model+kind.
 */
export interface MediaQuery {
  q?: string;
  make?: string;
  model?: string;
  variant?: string;
  model_year?: number;
  category?: string;
  colour?: string;
  kind?: 'exterior' | 'interior' | 'colour_swatch' | 'feature' | 'logo';
  view?: string;
  limit?: number;
}

export interface ExtractedVehicle {
  id: string;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  model_year?: number | null;
  price_inr?: number | null;
  fuel_type?: string | null;
  transmission?: string | null;
  body_type?: string | null;
  colours?: string[] | null;
  features?: string[] | null;
  specs?: Record<string, string> | null;
  confidence: number;
  review_status: string;
}

export interface IngestionJob {
  id: string;
  source_pdf_name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error_message?: string | null;
  page_count: number;
  image_count: number;
  vehicle_count: number;
  ai_engine?: string | null;
  created_at: string;
  completed_at?: string | null;
  images?: BrochureImage[];
  vehicles?: ExtractedVehicle[];
}

@Injectable({ providedIn: 'root' })
export class BrochureService {
  private readonly api = environment.apiUrl;

  /** Cached by "make|model" so a listing grid does not refetch per card. */
  private readonly cache = new Map<string, BrochureImage[]>();

  readonly uploading = signal(false);

  constructor(private http: HttpClient) {}

  /** Relative URLs come back from local storage; make them absolute. */
  absoluteUrl(url: string): string {
    return url.startsWith('http') ? url : `${this.api}${url}`;
  }

  /**
   * The one read path behind every surface that shows vehicle imagery.
   *
   * Brand, model, variant, comparison, advisor, search and the dealer portal
   * all call this with the filters they care about, rather than each keeping
   * its own copy of the images — which is what makes a single uploaded file
   * appear in all of them.
   */
  async images(query: MediaQuery): Promise<BrochureImage[]> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
    if (!params.has('limit')) params.set('limit', '12');

    const key = params.toString();
    const hit = this.cache.get(key);
    if (hit) return hit;

    try {
      const images = await firstValueFrom(
        this.http.get<BrochureImage[]>(`${this.api}/brochures/images?${params}`)
      );
      const resolved = (images ?? []).map(i => ({
        ...i,
        url: this.absoluteUrl(i.url),
        thumbnail_url: i.thumbnail_url ? this.absoluteUrl(i.thumbnail_url) : null,
      }));
      this.cache.set(key, resolved);
      return resolved;
    } catch {
      // A surface with no brochure imagery is a normal state, not an error —
      // the caller falls back to whatever images it already had.
      this.cache.set(key, []);
      return [];
    }
  }

  /**
   * Best single image for a vehicle, for cards and comparison rows.
   *
   * Prefers a front three-quarter exterior — the shot a brochure leads with —
   * and falls back to any exterior, then to anything at all, so a partially
   * classified library still yields a picture.
   */
  async heroImage(make: string, model: string, variant?: string): Promise<BrochureImage | null> {
    const attempts: MediaQuery[] = [
      { make, model, variant, kind: 'exterior', view: 'front_three_quarter', limit: 1 },
      { make, model, variant, kind: 'exterior', limit: 1 },
      { make, model, limit: 1 },
    ];
    for (const attempt of attempts) {
      const found = await this.images(attempt);
      if (found.length) return found[0];
    }
    return null;
  }

  /** Kept for callers written before the generic query existed. */
  async imagesFor(make: string, model: string): Promise<BrochureImage[]> {
    return this.images({ make, model, limit: 12 });
  }

  async recentImages(limit = 60): Promise<BrochureImage[]> {
    return this.images({ limit });
  }

  /** Admin: upload a brochure PDF and get back everything extracted from it. */
  async upload(file: File): Promise<IngestionJob> {
    this.uploading.set(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const job = await firstValueFrom(
        this.http.post<IngestionJob>(`${this.api}/brochures/upload`, form)
      );
      // A new brochure invalidates every cached lookup.
      this.cache.clear();
      return {
        ...job,
        images: (job.images ?? []).map(i => ({ ...i, url: this.absoluteUrl(i.url) })),
      };
    } finally {
      this.uploading.set(false);
    }
  }

  async jobs(): Promise<IngestionJob[]> {
    try {
      return await firstValueFrom(
        this.http.get<IngestionJob[]>(`${this.api}/brochures/jobs`)
      );
    } catch {
      return [];
    }
  }

  async deleteJob(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.api}/brochures/jobs/${id}`));
    this.cache.clear();
  }
}
