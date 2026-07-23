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
    const entry: UploadProgress = { jobId: '', filename: file.name, progress: 0 };
    this.uploadQueue.update(q => [...q, entry]);

    // Check if backend is reachable first
    const backendUp = await this._isBackendUp();

    if (backendUp) {
      return this._uploadToBackend(file, entry);
    } else {
      return this._uploadMockPipeline(file, entry);
    }
  }

  private async _isBackendUp(): Promise<boolean> {
    try {
      await this.http.get(`${this.base}/jobs`, { responseType: 'json' })
        .toPromise();
      return true;
    } catch {
      return false;
    }
  }

  private _uploadToBackend(file: File, entry: UploadProgress): Promise<void> {
    const formData = new FormData();
    formData.append('file', file);
    const req = new HttpRequest('POST', `${this.base}/upload`, formData, { reportProgress: true });

    return new Promise((resolve, reject) => {
      const sub = this.http.request(req).subscribe({
        next: event => {
          if (event.type === HttpEventType.UploadProgress && event.total) {
            entry.progress = Math.round(100 * event.loaded / event.total);
            this.uploadQueue.update(q => q.map(e => e.filename === file.name ? { ...e, progress: entry.progress } : e));
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
        error: () => {
          this._uploadSubs.delete(file.name);
          this.uploadQueue.update(q => q.filter(e => e.filename !== file.name));
          // Backend went down mid-upload — fall back to mock
          this._uploadMockPipeline(file, entry).then(resolve).catch(resolve);
        },
      });
      this._uploadSubs.set(file.name, sub);
    });
  }

  private async _uploadMockPipeline(file: File, entry: UploadProgress): Promise<void> {
    const jobId = crypto.randomUUID();
    const stages: ExtractionStatus[] = [
      'PARSING', 'EXTRACTING', 'MATCHING_IMAGES', 'VALIDATING', 'AWAITING_REVIEW'
    ];

    // Simulate upload progress
    for (let p = 10; p <= 100; p += 10) {
      await this._delay(120);
      entry.progress = p;
      this.uploadQueue.update(q => q.map(e => e.filename === file.name ? { ...e, progress: p } : e));
      if (!this.uploadQueue().some(e => e.filename === file.name)) return; // cancelled
    }

    const job: IngestionJob = {
      id: jobId,
      filename: file.name,
      file_size: file.size,
      status: 'PARSING',
      progress: 10,
      vehicles_found: 0,
      created_at: new Date().toISOString(),
      completed_at: null,
      error: null,
      vehicles: [],
    };
    this.jobs.update(j => [job, ...j]);
    entry.jobId = jobId;
    this.uploadQueue.update(q => q.filter(e => e.filename !== file.name));

    // Simulate pipeline stages
    for (let i = 0; i < stages.length; i++) {
      await this._delay(800 + Math.random() * 400);
      const progress = Math.round(((i + 1) / stages.length) * 90) + 10;
      job.status = stages[i];
      job.progress = progress;
      this.jobs.update(list => list.map(j => j.id === jobId ? { ...job } : j));
    }

    // Generate demo vehicles from filename
    const demoVehicles = this._generateDemoVehicles(file.name, jobId);
    job.vehicles = demoVehicles;
    job.vehicles_found = demoVehicles.length;
    job.status = 'AWAITING_REVIEW';
    job.progress = 100;
    job.completed_at = new Date().toISOString();
    this.jobs.update(list => list.map(j => j.id === jobId ? { ...job } : j));
    if (this.selectedJob()?.id === jobId) this.selectedJob.set({ ...job });
  }

  private _delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

  private _generateDemoVehicles(filename: string, jobId: string): ExtractedVehicle[] {
    const name = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    const words = name.split(' ').filter(Boolean);
    const make  = words[0] ?? 'Maruti Suzuki';
    const model = words[1] ?? 'Swift';

    const variants = [
      { variant: 'LXi', fuel: 'Petrol', tx: 'Manual',    price: 649000,  bhp: 89.7, kmpl: 23.2, score: 72 },
      { variant: 'VXi', fuel: 'Petrol', tx: 'Manual',    price: 749000,  bhp: 89.7, kmpl: 23.2, score: 78 },
      { variant: 'ZXi', fuel: 'Petrol', tx: 'Manual',    price: 849000,  bhp: 89.7, kmpl: 23.2, score: 85 },
      { variant: 'ZXi AMT', fuel: 'Petrol', tx: 'AMT',   price: 899000,  bhp: 89.7, kmpl: 22.6, score: 88 },
    ];

    return variants.map(v => ({
      id: crypto.randomUUID(),
      job_id: jobId,
      make,
      model,
      variant: v.variant,
      year: new Date().getFullYear(),
      body_type: 'Hatchback',
      fuel_type: v.fuel,
      transmission: v.tx,
      price_inr: v.price,
      engine_cc: 1197,
      power_bhp: v.bhp,
      torque_nm: 113,
      mileage_kmpl: v.kmpl,
      seating: 5,
      colours: ['Pearl Arctic White', 'Magma Grey', 'Midnight Blue'],
      specs: [
        { label: 'Engine', value: '1.2L DualJet' },
        { label: 'Airbags', value: '6' },
        { label: 'Warranty', value: '2 years / 40,000 km' },
      ],
      images: [],
      quality_score: v.score,
      confidence: { make: 0.95, model: 0.93, price_inr: 0.88 },
      status: v.score >= 75 ? 'READY' : 'NEEDS_REVIEW',
      duplicate_of: null,
      admin_notes: '⚠ Demo mode — backend offline. Data is illustrative.',
    } as ExtractedVehicle));
  }

  // ── Polling ─────────────────────────────────────────────────────────────

  async pollJob(jobId: string): Promise<IngestionJob> {
    try {
      const job = await this.http.get<IngestionJob>(`${this.base}/jobs/${jobId}`).toPromise();
      this.jobs.update(list => list.map(j => j.id === jobId ? job! : j));
      if (this.selectedJob()?.id === jobId) this.selectedJob.set(job!);
      return job!;
    } catch {
      return this.jobs().find(j => j.id === jobId)!;
    }
  }

  async loadJobs(): Promise<void> {
    try {
      const jobs = await this.http.get<IngestionJob[]>(`${this.base}/jobs`).toPromise();
      if (jobs?.length) this.jobs.set(jobs);
    } catch { /* backend offline — keep local state */ }
  }

  selectJob(job: IngestionJob) { this.selectedJob.set(job); }

  // ── Review actions ──────────────────────────────────────────────────────

  async approveVehicle(jobId: string, vehicleId: string, patch?: Partial<ExtractedVehicle>): Promise<void> {
    try {
      await this.http.post(`${this.base}/jobs/${jobId}/vehicles/${vehicleId}/approve`, patch ?? {}).toPromise();
      await this.pollJob(jobId);
    } catch {
      // Offline: update local state directly
      this.jobs.update(list => list.map(j => j.id === jobId ? {
        ...j, vehicles: j.vehicles.map(v => v.id === vehicleId ? { ...v, status: 'READY' as const } : v)
      } : j));
    }
    const job = this.jobs().find(j => j.id === jobId);
    const v = job?.vehicles.find(v => v.id === vehicleId);
    if (v) this.carsData.addApprovedVehicle(this._vehicleToCar(v));
  }

  async rejectVehicle(jobId: string, vehicleId: string, reason?: string): Promise<void> {
    try {
      await this.http.post(`${this.base}/jobs/${jobId}/vehicles/${vehicleId}/reject`, { reason }).toPromise();
      await this.pollJob(jobId);
    } catch {
      this.jobs.update(list => list.map(j => j.id === jobId ? {
        ...j, vehicles: j.vehicles.map(v => v.id === vehicleId ? { ...v, status: 'INCOMPLETE' as const } : v)
      } : j));
    }
  }

  async patchVehicle(jobId: string, vehicleId: string, patch: Partial<ExtractedVehicle>): Promise<void> {
    try {
      await this.http.patch(`${this.base}/jobs/${jobId}/vehicles/${vehicleId}`, patch).toPromise();
      await this.pollJob(jobId);
    } catch {
      this.jobs.update(list => list.map(j => j.id === jobId ? {
        ...j, vehicles: j.vehicles.map(v => v.id === vehicleId ? { ...v, ...patch } : v)
      } : j));
    }
  }

  async bulkApprove(jobId: string): Promise<void> {
    try {
      await this.http.post(`${this.base}/jobs/${jobId}/bulk-approve`, {}).toPromise();
      await this.pollJob(jobId);
    } catch {
      const job = this.jobs().find(j => j.id === jobId);
      job?.vehicles.filter(v => v.quality_score >= 75).forEach(v => {
        this.carsData.addApprovedVehicle(this._vehicleToCar(v));
      });
      this.jobs.update(list => list.map(j => j.id === jobId ? {
        ...j, vehicles: j.vehicles.map(v => v.quality_score >= 75 ? { ...v, status: 'READY' as const } : v)
      } : j));
    }
  }

  async assignImage(jobId: string, vehicleId: string, imageId: string): Promise<void> {
    try {
      await this.http.post(`${this.base}/jobs/${jobId}/vehicles/${vehicleId}/assign-image/${imageId}`, {}).toPromise();
      await this.pollJob(jobId);
    } catch { /* offline: no local image reassignment needed for demo */ }
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
