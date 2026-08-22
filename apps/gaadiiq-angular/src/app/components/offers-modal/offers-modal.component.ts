import {
  Component, EventEmitter, Input, Output, signal, computed, inject, OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LeadService } from '../../services/lead.service';
import { CityService, POPULAR_CITIES } from '../../services/city.service';
import { TranslatePipe } from '../../pipes/translate.pipe';

export type OffersStep = 'city' | 'phone' | 'done';

/**
 * "Get the best price" — a two-step enquiry that ends in a dealer callback.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not show offers. There is no offers data anywhere in the system: no
 * table, no field, no feed. A modal that ended on "₹40,000 off this month"
 * would be inventing a number the buyer would then hold a dealer to, which is
 * the same failure mode as a fabricated credit score — indistinguishable from
 * a real one at the point it is read, and believed.
 *
 * So the final step shows what we genuinely have — the published trim band and
 * the EMI already computed on the page — and says plainly that a dealer will
 * call with their price. If no verified dealer covers the buyer's city, it
 * says that instead of promising a call nobody will make.
 */
@Component({
  selector: 'app-offers-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './offers-modal.component.html',
  styleUrl: './offers-modal.component.scss',
})
export class OffersModalComponent implements OnInit {
  @Input({ required: true }) make!: string;
  @Input({ required: true }) model!: string;
  @Input() carId: string | null = null;
  @Input() variant: string | null = null;
  /** Shown on the final step. Already formatted by the caller. */
  @Input() priceText: string | null = null;
  @Input() emiText: string | null = null;

  @Output() closed = new EventEmitter<void>();

  private readonly leads = inject(LeadService);
  private readonly cities = inject(CityService);

  readonly popularCities = POPULAR_CITIES;

  step = signal<OffersStep>('city');
  busy = signal(false);
  error = signal<string | null>(null);

  city = '';
  locality = '';
  pincode = '';
  phoneRaw = '';
  otp = '';
  name = '';
  consent = false;

  /** How many dealers cover the city, once the lead is in. -1 = not yet known. */
  dealersInCity = signal(-1);

  ngOnInit(): void {
    // The navbar already holds a city and the user has usually set it, so
    // asking again from blank would be a step that answers itself.
    this.city = this.cities.selectedCity() || '';
  }

  // Plain fields with a method rather than computed(): `city` and `phoneRaw`
  // are bound with ngModel and are not signals, and a computed() over them
  // would evaluate once and then report a stale answer (CLAUDE.md).
  canContinueCity(): boolean {
    return this.city.trim().length > 1;
  }

  phoneE164(): string | null {
    return LeadService.toE164(this.phoneRaw);
  }

  canSendOtp(): boolean {
    return this.phoneE164() !== null && !this.busy();
  }

  canSubmit(): boolean {
    return this.otpSent() && this.otp.trim().length === 6 && this.consent && !this.busy();
  }

  otpSent = signal(false);

  goToPhone(): void {
    if (!this.canContinueCity()) return;
    this.error.set(null);
    this.step.set('phone');
  }

  backToCity(): void {
    this.error.set(null);
    this.step.set('city');
  }

  async sendOtp(): Promise<void> {
    const phone = this.phoneE164();
    if (!phone) {
      this.error.set('Enter a 10-digit Indian mobile number.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.leads.sendOtp(phone);
      this.otpSent.set(true);
    } catch (e: any) {
      // 429 is the send limit, which is a different instruction to the user
      // than "something went wrong".
      this.error.set(
        e?.status === 429
          ? 'Too many requests. Try again in a little while.'
          : 'Could not send the code. Check the number and try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  async submit(): Promise<void> {
    const phone = this.phoneE164();
    if (!phone || !this.consent) return;

    this.busy.set(true);
    this.error.set(null);
    try {
      const ack = await this.leads.submit({
        phone,
        otp: this.otp.trim(),
        city: this.city.trim(),
        locality: this.locality.trim() || null,
        pincode: this.pincode.trim() || null,
        car_id: this.carId,
        make: this.make,
        model: this.model,
        variant: this.variant,
        name: this.name.trim() || null,
        consent: true,
      });
      this.dealersInCity.set(ack.dealers_in_city);
      this.step.set('done');
    } catch (e: any) {
      const detail = e?.error?.detail;
      this.error.set(
        typeof detail === 'string'
          ? detail
          : 'Could not verify that code. Request a new one and try again.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  close(): void {
    this.closed.emit();
  }
}
