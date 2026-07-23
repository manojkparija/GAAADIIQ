import {
  Component, signal, computed, inject, OnInit, OnDestroy,
  ChangeDetectionStrategy, HostListener, ElementRef, ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PdfIngestionService, IngestionJob, ExtractedVehicle, ExtractedImage } from '../../services/pdf-ingestion.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-admin-pdf-ingestion',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-pdf-ingestion.component.html',
  styleUrls: ['./admin-pdf-ingestion.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPdfIngestionComponent implements OnInit, OnDestroy {
  svc   = inject(PdfIngestionService);
  auth  = inject(AuthService);

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  // UI state
  dragOver      = signal(false);
  activeTab     = signal<'upload' | 'jobs' | 'review'>('upload');
  editingId     = signal<string | null>(null);
  editDraft     = signal<Partial<ExtractedVehicle>>({});
  toastMsg      = signal('');
  private toastTimer: any;
  private pollTimer: any;

  // Computed
  pendingJobs = computed(() =>
    this.svc.jobs().filter(j => !['APPROVED','REJECTED','FAILED'].includes(j.status))
  );
  readyToApprove = computed(() =>
    this.svc.selectedJob()?.vehicles.filter(v => v.status === 'READY') ?? []
  );
  needsReview = computed(() =>
    this.svc.selectedJob()?.vehicles.filter(v => v.status === 'NEEDS_REVIEW') ?? []
  );
  incomplete = computed(() =>
    this.svc.selectedJob()?.vehicles.filter(v => v.status === 'INCOMPLETE') ?? []
  );
  unmatchedImages = computed(() => {
    const job = this.svc.selectedJob();
    if (!job) return [] as ExtractedImage[];
    return job.vehicles.flatMap(v => v.images.filter(i => !i.matched_variant));
  });

  async ngOnInit() {
    await this.svc.loadJobs();
    this.startPolling();
  }

  ngOnDestroy() { clearInterval(this.pollTimer); clearTimeout(this.toastTimer); }

  private startPolling() {
    this.pollTimer = setInterval(async () => {
      for (const job of this.pendingJobs()) {
        await this.svc.pollJob(job.id);
      }
    }, 4000);
  }

  // ── Drag-drop ──────────────────────────────────────────────────────────

  @HostListener('dragover', ['$event']) onDragOver(e: DragEvent) {
    e.preventDefault(); this.dragOver.set(true);
  }
  @HostListener('dragleave') onDragLeave() { this.dragOver.set(false); }
  @HostListener('drop', ['$event']) onDrop(e: DragEvent) {
    e.preventDefault(); this.dragOver.set(false);
    const files = Array.from(e.dataTransfer?.files ?? []).filter(f => f.type === 'application/pdf');
    if (files.length) this.handleFiles(files);
  }

  onFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter(f => f.type === 'application/pdf');
    if (files.length) this.handleFiles(files);
    input.value = '';
  }

  private async handleFiles(files: File[]) {
    this.activeTab.set('jobs');
    try {
      await this.svc.uploadFiles(files);
      this.toast(`${files.length} PDF${files.length > 1 ? 's' : ''} queued for processing`);
    } catch {
      this.toast('Upload failed — check file size or try again', true);
    }
  }

  // ── Review actions ─────────────────────────────────────────────────────

  openReview(job: IngestionJob) {
    this.svc.selectJob(job);
    this.activeTab.set('review');
  }

  startEdit(vehicle: ExtractedVehicle) {
    this.editingId.set(vehicle.id);
    this.editDraft.set({ ...vehicle });
  }
  cancelEdit() { this.editingId.set(null); this.editDraft.set({}); }

  async saveEdit(job: IngestionJob) {
    await this.svc.patchVehicle(job.id, this.editingId()!, this.editDraft());
    this.cancelEdit();
    this.toast('Changes saved');
  }

  async approve(job: IngestionJob, v: ExtractedVehicle) {
    await this.svc.approveVehicle(job.id, v.id);
    this.toast(`${v.make} ${v.model} ${v.variant} approved`);
  }

  async reject(job: IngestionJob, v: ExtractedVehicle) {
    await this.svc.rejectVehicle(job.id, v.id);
    this.toast(`${v.make} ${v.model} ${v.variant} rejected`);
  }

  async bulkApprove(job: IngestionJob) {
    await this.svc.bulkApprove(job.id);
    this.toast(`All READY records approved and published`);
  }

  async assignImage(job: IngestionJob, vehicleId: string, imageId: string) {
    await this.svc.assignImage(job.id, vehicleId, imageId);
    this.toast('Image assigned');
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  statusColour(status: string): string {
    return ({ READY:'#10B981', NEEDS_REVIEW:'#F59E0B', INCOMPLETE:'#F43F5E' } as any)[status] ?? '#64748B';
  }

  jobStatusIcon(status: string): string {
    return ({
      PENDING:'⏳', PARSING:'📄', EXTRACTING:'🧠', MATCHING_IMAGES:'🖼️',
      VALIDATING:'✅', AWAITING_REVIEW:'👁️', APPROVED:'🚀', REJECTED:'✕', FAILED:'❌',
    } as any)[status] ?? '•';
  }

  formatPrice(n: number | null): string {
    if (!n) return '—';
    return n >= 100000 ? `₹${(n/100000).toFixed(2)}L` : `₹${n.toLocaleString('en-IN')}`;
  }

  confidenceBar(score: number): string {
    const pct = Math.round(score * 100);
    const col = score >= .75 ? '#10B981' : score >= .5 ? '#F59E0B' : '#F43F5E';
    return `linear-gradient(90deg, ${col} ${pct}%, var(--border) ${pct}%)`;
  }

  private toast(msg: string, _err = false) {
    this.toastMsg.set(msg);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastMsg.set(''), 3500);
  }

  trackJob(_: number, j: IngestionJob) { return j.id; }
  trackVehicle(_: number, v: ExtractedVehicle) { return v.id; }
  trackImage(_: number, i: ExtractedImage) { return i.id; }
}
