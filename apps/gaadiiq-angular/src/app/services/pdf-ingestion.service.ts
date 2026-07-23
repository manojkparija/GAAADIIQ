import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpEventType, HttpRequest } from '@angular/common/http';
import { environment } from '../../environments/environment';

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
  private base = `${environment.apiUrl ?? 'http://localhost:8001'}/api/pdf-ingestion`;

  jobs         = signal<IngestionJob[]>([]);
  uploadQueue  = signal<UploadProgress[]>([]);
  selectedJob  = signal<IngestionJob | null>(null);

  // ── Upload ──────────────────────────────────────────────────────────────

  async uploadFiles(files: File[]): Promise<void> {
    for (const file of files) {
      await this.uploadSingle(file);
    }
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

      this.http.request(req).subscribe({
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
            resolve();
          }
        },
        error: err => { reject(err); },
      });
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
