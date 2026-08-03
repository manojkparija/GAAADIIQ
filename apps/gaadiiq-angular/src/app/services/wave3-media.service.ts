import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface OcrResult {
  text: string;
  confidence: number;
  entities: Record<string, any>;
  blocks: any[];
}

export interface SafetyResult {
  nsfw_score: number | null;
  license_plate_detected: boolean | null;
  license_plate_bbox: { x: number; y: number; width: number; height: number } | null;
  safety_metadata: Record<string, any> | null;
}

export interface SearchResult {
  id: string;
  url: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  model_year: number | null;
  image_category: string | null;
  similarity_score: number;
}

export interface UploadedImage {
  id: string;
  filename: string;
  url: string;
  thumbnail_url: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  model_year: number | null;
  image_category: string | null;
  colour: string | null;
  is_primary: boolean;
  sort_order: number;
  deduplicated: boolean;
  embedding_vector: number[] | null;
  ocr_text: string | null;
  ocr_confidence: number | null;
  ocr_entities: Record<string, any> | null;
  nsfw_score: number | null;
  license_plate_detected: boolean | null;
  license_plate_bbox: Record<string, any> | null;
  safety_metadata: Record<string, any> | null;
}

export interface UploadResult {
  stored: number;
  deduplicated: number;
  rejected: number;
  images: UploadedImage[];
  errors: string[];
}

@Injectable({ providedIn: 'root' })
export class Wave3MediaService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/media-admin`;

  uploadImages(
    files: File[],
    metadata: {
      make: string;
      model: string;
      model_year: number;
      category: string;
      fuel_type: string;
      transmission: string;
      image_category: string;
      variant?: string;
      colour?: string;
      alt_text?: string;
      seo_keywords?: string;
      source?: string;
      copyright?: string;
      license?: string;
    }
  ): Observable<UploadResult> {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('files', file);
    });
    Object.entries(metadata).forEach(([key, value]) => {
      if (value !== undefined) {
        formData.append(key, String(value));
      }
    });

    return this.http.post<UploadResult>(`${this.base}/upload`, formData)
      .pipe(catchError(() => of({ stored: 0, deduplicated: 0, rejected: files.length, images: [], errors: ['Upload failed'] })));
  }

  searchImages(query: string, limit = 10): Observable<SearchResult[]> {
    const params = new HttpParams()
      .set('q', query)
      .set('limit', String(limit));
    return this.http.get<SearchResult[]>(`${this.base}/search`, { params })
      .pipe(catchError(() => of([])));
  }

  getOcrResults(mediaId: string): Observable<OcrResult> {
    return this.http.get<OcrResult>(`${this.base}/${mediaId}/ocr`)
      .pipe(catchError(() => of({ text: '', confidence: 0, entities: {}, blocks: [] })));
  }

  getSafetyResults(mediaId: string): Observable<SafetyResult> {
    return this.http.get<SafetyResult>(`${this.base}/${mediaId}/safety`)
      .pipe(catchError(() => of({
        nsfw_score: null,
        license_plate_detected: null,
        license_plate_bbox: null,
        safety_metadata: null,
      })));
  }
}
