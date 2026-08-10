import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  CommissionPreview,
  MarketplaceService,
  MechanicProfile,
  ServiceRequest,
} from '../../services/marketplace.service';
import { AuthService } from '../../services/auth.service';
import { SeoService } from '../../services/seo.service';

/**
 * The mechanic's side of the marketplace.
 *
 * Until this existed a mechanic could not accept a job or price one — those
 * calls had to be made on their behalf, which is not a product. The screen is
 * deliberately narrow: see the jobs assigned to me, start one, price it, close
 * it. Everything else a mechanic might want can wait until someone asks.
 *
 * The quote step shows the commission split before the mechanic commits to a
 * price. A marketplace that reveals its cut only at settlement is one partners
 * leave, and they should be able to work backwards from the take-home they want.
 */
@Component({
  selector: 'app-mechanic-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './mechanic-dashboard.component.html',
  styleUrls: ['./mechanic-dashboard.component.scss'],
})
export class MechanicDashboardComponent {
  private readonly market = inject(MarketplaceService);
  readonly auth = inject(AuthService);
  private readonly seo = inject(SeoService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busyId = signal<string | null>(null);

  readonly profile = signal<MechanicProfile | null>(null);
  readonly jobs = signal<ServiceRequest[]>([]);

  /** Which job's quote box is open, and what has been typed into it. */
  readonly quotingId = signal<string | null>(null);
  // A signal, not a plain field: `livePreview` is a computed() and only tracks
  // signal reads, so a plain property would never trigger a recompute and the
  // split would sit frozen while the mechanic typed.
  readonly quoteRupees = signal<number | null>(null);
  readonly quotePreview = signal<CommissionPreview | null>(null);

  /** Live jobs first — a mechanic opens this to see what needs doing now. */
  readonly activeJobs = computed(() =>
    this.jobs().filter(j => !['completed', 'cancelled'].includes(j.status)),
  );
  readonly pastJobs = computed(() =>
    this.jobs().filter(j => ['completed', 'cancelled'].includes(j.status)),
  );

  constructor() {
    this.seo.setPage('Mechanic Dashboard — GAADIIQ', 'Manage the repair jobs assigned to your workshop: accept, price and close them out.');
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    // Signed-out visitors get the sign-in panel, not a 401 banner beside it.
    // Calling an authenticated endpoint here would surface "Not authenticated"
    // in red above a message that already explains the situation calmly.
    if (!this.auth.currentUser()) {
      this.profile.set(null);
      this.jobs.set([]);
      this.loading.set(false);
      return;
    }

    try {
      const profile = await this.market.myMechanicProfile();
      this.profile.set(profile);
      // No profile means "not a mechanic", so there is nothing to list and the
      // template offers registration instead.
      this.jobs.set(profile ? await this.market.assignedToMe() : []);
    } catch (e) {
      this.error.set(this.readableError(e));
    } finally {
      this.loading.set(false);
    }
  }

  async start(job: ServiceRequest): Promise<void> {
    await this.run(job.id, () => this.market.startWork(job.id));
  }

  async complete(job: ServiceRequest): Promise<void> {
    await this.run(job.id, () => this.market.completeRequest(job.id));
  }

  openQuote(job: ServiceRequest): void {
    this.quotingId.set(job.id);
    this.quotePreview.set(null);
    // Pre-fill with any existing quote so a correction starts from the number
    // already on the job rather than an empty box.
    this.quoteRupees.set(job.quoted_amount_paise ? job.quoted_amount_paise / 100 : null);
  }

  cancelQuote(): void {
    this.quotingId.set(null);
    this.quotePreview.set(null);
    this.quoteRupees.set(null);
  }

  /**
   * The split for what has been typed, computed locally for instant feedback.
   *
   * Mirrors services/commission.py — 10%, floored at ₹49 and capped at ₹2,500.
   * This is a preview only; the figures that settle are the ones the server
   * returns and freezes onto the payment.
   */
  readonly livePreview = computed(() => {
    const rupees = this.quoteRupees();
    if (!rupees || rupees <= 0) return null;
    const gross = Math.round(rupees * 100);
    let commission = Math.floor((gross * 1000) / 10_000);
    commission = Math.max(commission, 4900);
    commission = Math.min(commission, 250000, gross);
    return { gross, commission, payout: gross - commission };
  });

  async submitQuote(job: ServiceRequest): Promise<void> {
    const rupees = this.quoteRupees();
    if (!rupees || rupees <= 0) {
      this.error.set('Enter the amount you are charging for this repair.');
      return;
    }
    this.busyId.set(job.id);
    this.error.set(null);
    try {
      this.quotePreview.set(await this.market.quote(job.id, rupees));
      this.jobs.set(await this.market.assignedToMe());
      this.quotingId.set(null);
      this.quoteRupees.set(null);
    } catch (e) {
      this.error.set(this.readableError(e));
    } finally {
      this.busyId.set(null);
    }
  }

  async toggleAvailability(): Promise<void> {
    const p = this.profile();
    if (!p) return;
    this.busyId.set(p.id);
    try {
      this.profile.set(await this.market.setAvailability(p.id, !p.is_available));
    } catch (e) {
      this.error.set(this.readableError(e));
    } finally {
      this.busyId.set(null);
    }
  }

  money(paise: number | null | undefined): string {
    return paise == null ? '—' : this.market.formatPaise(paise);
  }

  telHref(phone: string | null | undefined): string {
    return `tel:${(phone ?? '').replace(/[^0-9+]/g, '')}`;
  }

  /** Google Maps directions to where the car is stranded. */
  directionsUrl(job: ServiceRequest): string {
    return `https://www.google.com/maps/dir/?api=1&destination=${job.latitude},${job.longitude}`;
  }

  statusLabel(status: ServiceRequest['status']): string {
    return {
      open: 'Waiting',
      assigned: 'New job',
      in_progress: 'In progress',
      awaiting_payment: 'Awaiting payment',
      paid: 'Paid',
      completed: 'Completed',
      cancelled: 'Cancelled',
    }[status];
  }

  private async run(id: string, fn: () => Promise<unknown>): Promise<void> {
    this.busyId.set(id);
    this.error.set(null);
    try {
      await fn();
      this.jobs.set(await this.market.assignedToMe());
    } catch (e) {
      this.error.set(this.readableError(e));
    } finally {
      this.busyId.set(null);
    }
  }

  private readableError(e: unknown): string {
    const detail = (e as { error?: { detail?: unknown } })?.error?.detail;
    if (typeof detail === 'string') return detail;
    const status = (e as { status?: number })?.status;
    if (status === 401 || status === 403) return 'Please sign in as a mechanic to manage jobs.';
    return 'Something went wrong. Please try again.';
  }
}
