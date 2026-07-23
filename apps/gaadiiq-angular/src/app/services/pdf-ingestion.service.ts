import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpEventType, HttpRequest } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { environment } from '../../environments/environment';
import { CarsDataService, Car } from './cars-data.service';

// ── Types ────────────────────────────────────────────────────────────────────

export type ExtractionStatus =
  | 'PENDING' | 'PARSING' | 'EXTRACTING' | 'MATCHING_IMAGES'
  | 'VALIDATING' | 'AWAITING_REVIEW' | 'APPROVED' | 'REJECTED' | 'FAILED';

export interface ExtractedSpec { label: string; value: string; }

export interface ExtractedImage {
  id: string;
  url: string;
  colour: string | null;
  match_confidence: number;
  matched_variant: string | null;
  page_num: number;
}

export interface ExtractedVehicle {
  id: string;
  job_id: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  year: number | null;
  body_type: string | null;
  fuel_type: string | null;
  transmission: string | null;
  price_inr: number | null;
  engine_cc: number | null;
  power_bhp: number | null;
  torque_nm: number | null;
  mileage_kmpl: number | null;
  seating: number | null;
  colours: string[];
  specs: ExtractedSpec[];
  images: ExtractedImage[];
  quality_score: number;
  confidence: Record<string, number>;
  status: 'READY' | 'NEEDS_REVIEW' | 'INCOMPLETE';
  duplicate_of: string | null;
  admin_notes: string;
}

export interface IngestionJob {
  id: string;
  filename: string;
  file_size: number;
  status: ExtractionStatus;
  progress: number;          // 0–100
  vehicles_found: number;
  created_at: string;
  completed_at: string | null;
  error: string | null;
  vehicles: ExtractedVehicle[];
}

export interface UploadProgress { jobId: string; filename: string; progress: number; }

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class PdfIngestionService {
  private http = inject(HttpClient);
  private carsData = inject(CarsDataService);
  private base = `${environment.apiUrl ?? 'http://localhost:8001'}/api/pdf-ingestion`;

  jobs         = signal<IngestionJob[]>([]);
  uploadQueue  = signal<UploadProgress[]>([]);
  selectedJob  = signal<IngestionJob | null>(null);

  private _uploadSubs = new Map<string, Subscription>();

  // ── Upload ──────────────────────────────────────────────────────────────

  async uploadFiles(files: File[]): Promise<void> {
    for (const file of files) {
      await this.uploadSingle(file);
    }
  }

  cancelUpload(filename: string): void {
    this._uploadSubs.get(filename)?.unsubscribe();
    this._uploadSubs.delete(filename);
    this.uploadQueue.update(q => q.filter(e => e.filename !== filename));
  }

  private async uploadSingle(file: File): Promise<void> {
    const formData = new FormData();
    formData.append('file', file);

    const req = new HttpRequest('POST', `${this.base}/upload`, formData, {
      reportProgress: true,
    });

    return new Promise((resolve, reject) => {
      const entry: UploadProgress = { jobId: '', filename: file.name, progress: 0 };
      this.uploadQueue.update(q => [...q, entry]);

      const sub = this.http.request(req).subscribe({
        next: event => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            entry.progress = Math.round(100 * event.loaded / event.total);
            this.uploadQueue.update(q => q.map(e => e.filename === file.name ? entry : e));
          }
          if (event.type === HttpEventType.Response) {
            const job = event.body as IngestionJob;
            entry.jobId = job.id;
            this.jobs.update(j => [job, ...j]);
            this.uploadQueue.update(q => q.filter(e => e.filename !== file.name));
            this._uploadSubs.delete(file.name);
            resolve();
          }
        },
        error: err => {
          this._uploadSubs.delete(file.name);
          this.uploadQueue.update(q => q.filter(e => e.filename !== file.name));
          reject(err);
        },
      });
      this._uploadSubs.set(file.name, sub);
    });
  }

  // ── Polling ─────────────────────────────────────────────────────────────

  async pollJob(jobId: string): Promise<IngestionJob> {
    const job = await this.http.get<IngestionJob>(`${this.base}/jobs/${jobId}`).toPromise();
    this.jobs.update(list => list.map(j => j.id === jobId ? job! : j));
    if (this.selectedJob()?.id === jobId) this.selectedJob.set(job!);
    return job!;
  }

  async loadJobs(): Promise<void> {
    const jobs = await this.http.get<IngestionJob[]>(`${this.base}/jobs`).toPromise();
    this.jobs.set(jobs ?? []);
  }

  selectJob(job: IngestionJob) { this.selectedJob.set(job); }

  // ── Review actions ──────────────────────────────────────────────────────

  async approveVehicle(jobId: string, vehicleId: string, patch?: Partial<ExtractedVehicle>): Promise<void> {
    await this.http.post(`${this.base}/jobs/${jobId}/vehicles/${vehicleId}/approve`, patch ?? {}).toPromise();
    await this.pollJob(jobId);
    // Push approved vehicle into New Cars listing immediately
    const job = this.jobs().find(j => j.id === jobId);
    const v = job?.vehicles.find(v => v.id === vehicleId);
    if (v) this.carsData.addApprovedVehicle(this._vehicleToCar(v));
  }

  private _vehicleToCar(v: ExtractedVehicle): Car {
    const image = v.images.find(i => i.matched_variant)?.url
      ?? v.images[0]?.url
      ?? 'assets/cars/placeholder.svg';
    return {
      id: v.id,
      make: v.make ?? 'Unknown',
      model: v.model ?? 'Unknown',
      variant: v.variant ?? undefined,
      year: v.year ?? new Date().getFullYear(),
      price: v.price_inr ?? 0,
      km: 0,
      fuel: v.fuel_type ?? 'Petrol',
      transmission: v.transmission ?? 'Manual',
      badge: 'New',
      badgeType: 'new',
      image,
      images: v.images.map(i => i.url),
      rating: 4.0,
      reviews: 0,
      verified: true,
      bodyType: v.body_type ?? undefined,
      specs: v.specs,
    };
  }

  async rejectVehicle(jobId: string, vehicleId: string, reason?: string): Promise<void> {
    await this.http.post(`${this.base}/jobs/${jobId}/vehicles/${vehicleId}/reject`, { reason }).toPromise();
    await this.pollJob(jobId);
  }

  async patchVehicle(jobId: string, vehicleId: string, patch: Partial<ExtractedVehicle>): Promise<void> {
    await this.http.patch(`${this.base}/jobs/${jobId}/vehicles/${vehicleId}`, patch).toPromise();
    await this.pollJob(jobId);
  }

  async bulkApprove(jobId: string): Promise<void> {
    await this.http.post(`${this.base}/jobs/${jobId}/bulk-approve`, {}).toPromise();
    await this.pollJob(jobId);
  }

  async assignImage(jobId: string, vehicleId: string, imageId: string): Promise<void> {
    await this.http.post(
      `${this.base}/jobs/${jobId}/vehicles/${vehicleId}/assign-image/${imageId}`, {}
    ).toPromise();
    await this.pollJob(jobId);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  qualityColour(score: number): string {
    if (score >= 75) return '#10B981';
    if (score >= 40) return '#F59E0B';
    return '#F43F5E';
  }
}
