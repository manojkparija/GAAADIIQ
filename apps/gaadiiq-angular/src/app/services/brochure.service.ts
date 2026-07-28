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
  content_type: string;
  width?: number | null;
  height?: number | null;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  colour?: string | null;
  source_pdf_name: string;
  page_number?: number | null;
  created_at: string;
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

  async imagesFor(make: string, model: string): Promise<BrochureImage[]> {
    const key = `${make}|${model}`.toLowerCase();
    const hit = this.cache.get(key);
    if (hit) return hit;

    try {
      const params = new URLSearchParams({ make, model, limit: '12' });
      const images = await firstValueFrom(
        this.http.get<BrochureImage[]>(`${this.api}/brochures/images?${params}`)
      );
      const resolved = (images ?? []).map(i => ({ ...i, url: this.absoluteUrl(i.url) }));
      this.cache.set(key, resolved);
      return resolved;
    } catch {
      // A missing brochure is not an error worth surfacing — the caller falls
      // back to whatever images it already had.
      this.cache.set(key, []);
      return [];
    }
  }

  async recentImages(limit = 60): Promise<BrochureImage[]> {
    try {
      const images = await firstValueFrom(
        this.http.get<BrochureImage[]>(`${this.api}/brochures/images?limit=${limit}`)
      );
      return (images ?? []).map(i => ({ ...i, url: this.absoluteUrl(i.url) }));
    } catch {
      return [];
    }
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
