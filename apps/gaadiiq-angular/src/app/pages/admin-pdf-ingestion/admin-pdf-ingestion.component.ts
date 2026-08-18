import {
  Component, signal, computed, inject, OnInit, OnDestroy,
  ChangeDetectionStrategy, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PdfIngestionService, IngestionJob, ExtractedVehicle, ExtractedImage } from '../../services/pdf-ingestion.service';
import { AuthService } from '../../services/auth.service';
import { CustomSelectComponent, SelectOption } from '../../components/custom-select/custom-select.component';

@Component({
  selector: 'app-admin-pdf-ingestion',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CustomSelectComponent],
  templateUrl: './admin-pdf-ingestion.component.html',
  styleUrls: ['./admin-pdf-ingestion.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPdfIngestionComponent implements OnInit, OnDestroy {
  svc   = inject(PdfIngestionService);
  auth  = inject(AuthService);

  /** The vehicles an unmatched image can be assigned to, for the dropdown. */
  vehicleOptions(job: any): SelectOption[] {
    return (job?.vehicles ?? []).map((v: any) => ({
      value: String(v.id),
      label: [v.make, v.model, v.variant].filter(Boolean).join(' '),
    }));
  }

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

  /**
   * Jobs the server can still change on its own — the only ones worth polling.
   *
   * Separate from pendingJobs, which drives the "needs your attention" badge
   * and therefore includes AWAITING_REVIEW. That status is where every
   * completed ingestion lands and it never changes without a human, so polling
   * it asks the same question forever: eight finished brochures produced a
   * sustained two requests a second against the API for as long as the tab
   * stayed open.
   */
  jobsStillProcessing = computed(() =>
    this.svc.jobs().filter(j =>
      ['PENDING', 'PARSING', 'EXTRACTING', 'MATCHING_IMAGES', 'VALIDATING'].includes(j.status)
    )
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
      const inFlight = this.jobsStillProcessing();
      // No request at all when nothing is in flight. The common resting state
      // of this screen is a list of finished jobs, and it should cost nothing.
      if (!inFlight.length) return;

      for (const job of inFlight) {
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
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) this.handleFiles(files);
  }

  onFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length) this.handleFiles(files);
    input.value = '';
  }

  private handleFiles(files: File[]) {
    // Warn about very large files — browsers buffer FormData in RAM before sending
    const MAX_WARN_MB = 500;
    const large = files.filter(f => f.size > MAX_WARN_MB * 1024 * 1024);
    if (large.length) {
      const names = large.map(f => `${f.name} (${(f.size / 1024 / 1024 / 1024).toFixed(1)} GB)`).join(', ');
      this.toast(`⚠ Large file(s): ${names}. Files over 500 MB may fail in-browser. Use the backend CLI for very large PDFs.`);
    }
    this.svc.setPendingFiles(files);
    // Modal will appear; upload starts after category is selected
  }

  async selectCategory(type: 'new' | 'used') {
    const count = this.svc.pendingFiles().length;
    await this.svc.startUploadWithCategory(type);
    this.activeTab.set('jobs');
    this.toast(`${count} file${count > 1 ? 's' : ''} queued as ${type === 'new' ? 'New Cars' : 'Used Cars'}`);
  }

  cancelUpload(filename: string) {
    this.svc.cancelUpload(filename);
    this.toast(`Upload cancelled: ${filename}`);
  }

  /**
   * Every image extracted from the brochure.
   *
   * Read off the job rather than off a vehicle: images and vehicle records are
   * produced by two independent steps, so a job can legitimately have images
   * and no vehicles.
   */
  jobImages(job: IngestionJob): ExtractedImage[] {
    return (job as any).images ?? job.vehicles.flatMap(v => v.images ?? []);
  }

  // ── Review actions ─────────────────────────────────────────────────────

  async openReview(job: IngestionJob) {
    // Show what we already have immediately, then fetch the full record.
    // The jobs LIST endpoint omits images and vehicles to keep the response
    // small, so opening a job straight from the list showed an empty review
    // screen no matter what the brochure contained.
    this.svc.selectJob(job);
    this.activeTab.set('review');
    await this.svc.loadJob(job.id);
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

  get job(): IngestionJob { return this.svc.selectedJob()!; }

  updateDraftField(key: string, type: string, event: Event) {
    const raw = (event.target as HTMLInputElement).value;
    const val = type === 'number' ? +raw : raw;
    this.editDraft.update(d => ({ ...d, [key]: val }));
  }

  trackJob(_: number, j: IngestionJob) { return j.id; }
  trackVehicle(_: number, v: ExtractedVehicle) { return v.id; }
  trackImage(_: number, i: ExtractedImage) { return i.id; }
}
