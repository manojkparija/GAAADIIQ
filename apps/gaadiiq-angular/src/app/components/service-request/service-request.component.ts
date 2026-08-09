import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';
import {
  CommissionPreview,
  MarketplaceService,
  NearbyMechanic,
  ServicePayment,
  ServiceRequest,
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
  imports: [CommonModule, FormsModule],
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
    if (!fix || !mechanic) return;

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
      const assigned = await this.market.assignMechanic(created.id, mechanic.id);
      this.request.set(assigned);
      this.stage.set('awaiting');
    } catch (e) {
      this.error.set(this.readableError(e));
    } finally {
      this.busy.set(false);
    }
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
