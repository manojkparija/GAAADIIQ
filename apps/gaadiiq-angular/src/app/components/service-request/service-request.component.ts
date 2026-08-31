import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import { TranslatePipe } from '../../pipes/translate.pipe';
import {
  CommissionPreview,
  DispatchResult,
  MarketplaceService,
  NearbyMechanic,
  ServicePayment,
  ServiceRequest,
  StartOtp,
} from '../../services/marketplace.service';

type Stage = 'locating' | 'choose' | 'details' | 'awaiting' | 'paying' | 'done';

/**
 * Raise a repair job with a GAADIIQ partner mechanic, from the roadside.
 *
 * Hosted inside the AI Diagnosis "find help" modal, and deliberately ordered so
 * the slow, permission-gated step happens first: the location fix is requested
 * on open, because everything downstream depends on where the car actually is
 * and there is nothing useful to show until it resolves.
 *
 * The mechanic list is fetched without a login — a stranded driver should not
 * have to sign up to see who is nearby. Only raising the request needs an
 * account, and that is the point at which the component says so.
 */
@Component({
  selector: 'app-service-request',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './service-request.component.html',
  styleUrls: ['./service-request.component.scss'],
})
export class ServiceRequestComponent {
  private readonly market = inject(MarketplaceService);
  private readonly sanitizer = inject(DomSanitizer);

  /** Prefilled from the diagnosis so the user retypes as little as possible. */
  @Input() manufacturer = '';
  @Input() model = '';
  @Input() problemSummary = '';
  @Input() severity = '';
  @Input() diagnosisId?: string;

  @Output() closed = new EventEmitter<void>();

  readonly stage = signal<Stage>('locating');
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  readonly fix = signal<{ latitude: number; longitude: number; accuracy_m: number } | null>(null);
  readonly mechanics = signal<NearbyMechanic[]>([]);
  readonly chosen = signal<NearbyMechanic | null>(null);
  readonly request = signal<ServiceRequest | null>(null);
  readonly payment = signal<ServicePayment | null>(null);

  /** Result of a broadcast, when the user chose not to pick a mechanic. */
  readonly dispatch = signal<DispatchResult | null>(null);

  /**
   * The arrival code, fetched once and then held.
   *
   * Deliberately not re-fetched on refresh() or on any timer. Every call to the
   * API mints a fresh code and retires the previous one, so polling would
   * change the number on screen while the customer is part-way through reading
   * it out — and the digits the mechanic already typed would stop working for
   * no visible reason.
   */
  readonly startOtp = signal<StartOtp | null>(null);
  readonly otpBusy = signal(false);

  // Form fields the diagnosis cannot supply.
  carNumber = '';
  contactPhone = '';
  landmark = '';

  constructor() {
    void this.locate();
  }

  /** Ask for the fix, then immediately search around it. */
  async locate(): Promise<void> {
    this.stage.set('locating');
    this.error.set(null);
    try {
      const fix = await this.market.currentPosition();
      this.fix.set(fix);
      const found = await this.market.nearby(fix.latitude, fix.longitude);
      this.mechanics.set(found);
      this.stage.set('choose');
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not find mechanics near you.');
      this.stage.set('choose');
    }
  }

  /**
   * Broadcast to every available mechanic nearby instead of picking one.
   *
   * The default at the roadside: someone whose car has stopped should not be
   * comparison-shopping, and whoever happens to sort first in the list is not
   * whoever can arrive soonest.
   */
  broadcastInstead(): void {
    this.chosen.set(null);
    this.error.set(null);
    this.stage.set('details');
  }

  choose(m: NearbyMechanic): void {
    this.chosen.set(m);
    this.error.set(null);
    this.stage.set('details');
  }

  backToList(): void {
    this.error.set(null);
    this.stage.set('choose');
  }

  /** Create the request and attach the chosen mechanic. */
  async submit(): Promise<void> {
    const fix = this.fix();
    const mechanic = this.chosen();
    // No mechanic is the broadcast path, not a missing selection.
    if (!fix) return;

    const car = this.carNumber.replace(/[\s-]/g, '').toUpperCase();
    if (car.length < 6) {
      this.error.set('Enter the car registration number, e.g. OD02AB1234.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    try {
      const created = await this.market.createRequest({
        car_number: car,
        manufacturer: this.manufacturer || undefined,
        model: this.model || undefined,
        latitude: fix.latitude,
        longitude: fix.longitude,
        location_accuracy_m: fix.accuracy_m,
        landmark: this.landmark || undefined,
        contact_phone: this.contactPhone || undefined,
        problem_summary: this.problemSummary || 'Roadside assistance requested',
        severity: this.severity || undefined,
        diagnosis_id: this.diagnosisId,
      });
      if (mechanic) {
        this.request.set(await this.market.assignMechanic(created.id, mechanic.id));
      } else {
        // The broadcast can find nobody, and until now that failed AFTER the
        // request was written: the customer saw an error, and an open job they
        // never knowingly raised sat in their history with no mechanic ever
        // told about it. Withdraw it, so a failed send leaves nothing behind.
        try {
          this.dispatch.set(await this.market.dispatch(created.id));
        } catch (e) {
          await this.withdrawQuietly(created.id);
          throw e;
        }
        this.request.set(created);
      }
      // Fetched here, once, while the customer is looking at the screen — not
      // in awaiting's refresh(), which they may trigger repeatedly.
      await this.loadStartOtp(created.id);
      this.stage.set('awaiting');
    } catch (e) {
      this.error.set(this.readableError(e));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Withdraw a request whose dispatch failed, without masking why it failed.
   *
   * The cancel itself is best-effort on purpose: if it too fails, the customer
   * must still be told about the original problem, not about the cleanup.
   */
  private async withdrawQuietly(requestId: string): Promise<void> {
    try {
      await this.market.cancelRequest(requestId, 'No mechanic could be reached');
    } catch {
      /* The dispatch error below is the one worth showing. */
    }
  }

  /**
   * Can the broadcast do anything?
   *
   * It was offered as the primary action above the list, unconditionally — so
   * where no partner mechanic is registered the screen said "No GAADIIQ partner
   * mechanics are registered near you yet" and, directly above it, invited the
   * driver to send the job to those same nonexistent mechanics. Pressing it
   * created a request and then failed with a 503.
   *
   * A search that succeeded and found nobody is the one case where we know
   * there is nothing to broadcast to. A search that FAILED tells us nothing, so
   * the button stays: the server may still find someone.
   */
  canBroadcast(): boolean {
    return this.mechanics().length > 0 || this.error() !== null;
  }

  /** Fetch the arrival code once. Safe to call again only on explicit request. */
  async loadStartOtp(requestId: string): Promise<void> {
    this.otpBusy.set(true);
    try {
      this.startOtp.set(await this.market.startOtp(requestId));
    } catch {
      // Not fatal: the job is raised either way, and the mechanic can be
      // started by the customer confirming in person. Better a missing code
      // than a red banner over a request that did go through.
      this.startOtp.set(null);
    } finally {
      this.otpBusy.set(false);
    }
  }

  /** Explicit "I need a new code" — retires the old one on the server. */
  async regenerateOtp(): Promise<void> {
    const sr = this.request();
    if (sr) await this.loadStartOtp(sr.id);
  }

  /**
   * Open payment for the mechanic's quote.
   *
   * Only possible once the mechanic has quoted — until then there is no amount,
   * and the API refuses with a 409 rather than inventing one.
   */
  async pay(): Promise<void> {
    const sr = this.request();
    if (!sr) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.payment.set(await this.market.startPayment(sr.id));
      this.stage.set('paying');
    } catch (e) {
      this.error.set(this.readableError(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** Confirm payment; the API captures it and fires the WhatsApp receipt. */
  async confirmPaid(): Promise<void> {
    const sr = this.request();
    if (!sr) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.request.set(await this.market.verifyPayment(sr.id));
      this.stage.set('done');
    } catch (e) {
      this.error.set(this.readableError(e));
    } finally {
      this.busy.set(false);
    }
  }

  /** Re-check whether the mechanic has quoted yet. */
  async refresh(): Promise<void> {
    const sr = this.request();
    if (!sr) return;
    this.busy.set(true);
    try {
      const mine = await this.market.myRequests(5);
      const fresh = mine.find(r => r.id === sr.id);
      if (fresh) this.request.set(fresh);
    } catch {
      // A failed refresh is not worth an error banner — the button can be
      // pressed again, and the state on screen is still the last known good one.
    } finally {
      this.busy.set(false);
    }
  }

  money(paise: number | null | undefined): string {
    return paise == null ? '—' : this.market.formatPaise(paise);
  }

  commission(): CommissionPreview | null {
    return this.payment()?.commission ?? null;
  }

  /** Angular blocks upi: URIs unless they are explicitly trusted. */
  safeUpi(uri: string): SafeUrl {
    return this.sanitizer.bypassSecurityTrustUrl(uri);
  }

  telHref(phone: string): string {
    return `tel:${phone.replace(/[^0-9+]/g, '')}`;
  }

  close(): void {
    this.closed.emit();
  }

  private readableError(e: unknown): string {
    const detail = (e as { error?: { detail?: unknown } })?.error?.detail;
    if (typeof detail === 'string') return detail;
    const status = (e as { status?: number })?.status;
    if (status === 401 || status === 403) {
      return 'Please sign in to raise a service request.';
    }
    if (status === 503) {
      return 'The mechanic network is not switched on yet. Please try again later.';
    }
    return 'Something went wrong. Please try again.';
  }
}
