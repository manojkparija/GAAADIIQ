import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MarketplaceService, MechanicRegistration } from '../../services/marketplace.service';
import { AuthService } from '../../services/auth.service';
import { SeoService } from '../../services/seo.service';
import { TranslatePipe } from '../../pipes/translate.pipe';

const SPECIALISATIONS = [
  'general', 'engine', 'electrical', 'transmission', 'ac', 'bodywork', 'tyres', 'ev',
];

/**
 * Mechanic self-registration.
 *
 * Two things this screen has to get right, both about the Aadhaar field.
 *
 * It is mandatory — the platform will not register a mechanic without one — but
 * the number is never stored. The API validates it (including its Verhoeff
 * check digit), keeps a peppered hash and the last four digits, and discards
 * the rest, because a private entity holding raw Aadhaar numbers is an offence
 * under the Aadhaar Act. The form says so plainly rather than making the
 * mechanic wonder where their number went.
 *
 * And the form must be submitted while signed in, or the row is created with no
 * linked account and the mechanic can never act on their own jobs. Rather than
 * let that happen and fail confusingly later, the screen refuses to submit and
 * sends them to sign in first.
 */
@Component({
  selector: 'app-mechanic-signup',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe],
  templateUrl: './mechanic-signup.component.html',
  styleUrls: ['./mechanic-signup.component.scss'],
})
export class MechanicSignupComponent {
  private readonly market = inject(MarketplaceService);
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  private readonly seo = inject(SeoService);

  readonly specialisations = SPECIALISATIONS;
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly locating = signal(false);
  readonly located = signal(false);

  form: MechanicRegistration = {
    full_name: '',
    shop_name: '',
    phone: '',
    address_line1: '',
    city: '',
    state: '',
    area_pincode: '',
    pan_number: '',
    aadhaar_number: '',
    upi_vpa: '',
    service_radius_km: 15,
    specialisations: ['general'],
  };

  constructor() {
    this.seo.setPage('Register as a Mechanic — GAADIIQ', 'Join the GAADIIQ mechanic network. Receive jobs from drivers nearby and set your own price.');
  }

  toggleSpecialisation(s: string): void {
    const current = this.form.specialisations ?? [];
    this.form.specialisations = current.includes(s)
      ? current.filter(x => x !== s)
      : [...current, s];
  }

  isSelected(s: string): boolean {
    return (this.form.specialisations ?? []).includes(s);
  }

  /**
   * Capture the workshop's coordinates from the browser.
   *
   * Without these the mechanic is invisible to the nearest-mechanic search —
   * it filters on latitude and longitude — so this is effectively required
   * even though the API accepts the row without it.
   */
  async useMyLocation(): Promise<void> {
    this.locating.set(true);
    this.error.set(null);
    try {
      const fix = await this.market.currentPosition();
      this.form.latitude = fix.latitude;
      this.form.longitude = fix.longitude;
      this.located.set(true);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Could not get your location.');
    } finally {
      this.locating.set(false);
    }
  }

  async submit(): Promise<void> {
    this.error.set(null);

    if (!this.auth.currentUser()) {
      this.error.set('Please sign in first — your mechanic profile is linked to your account.');
      return;
    }
    if (this.form.latitude == null || this.form.longitude == null) {
      this.error.set('Set your workshop location — drivers find you by distance.');
      return;
    }

    this.busy.set(true);
    try {
      await this.market.registerMechanic({
        ...this.form,
        // Trim the optional strings the API would rather receive as absent than
        // as an empty string.
        shop_name: this.form.shop_name?.trim() || undefined,
        upi_vpa: this.form.upi_vpa?.trim() || undefined,
        pan_number: this.form.pan_number.trim().toUpperCase(),
        aadhaar_number: this.form.aadhaar_number.replace(/[\s-]/g, ''),
      });
      await this.router.navigate(['/mechanic-dashboard']);
    } catch (e) {
      this.error.set(this.readableError(e));
    } finally {
      this.busy.set(false);
    }
  }

  private readableError(e: unknown): string {
    const detail = (e as { error?: { detail?: unknown } })?.error?.detail;
    // FastAPI validation errors arrive as a list of field problems; surface the
    // first message rather than "[object Object]".
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0] as { msg?: string; loc?: unknown[] };
      const field = Array.isArray(first.loc) ? String(first.loc[first.loc.length - 1]) : '';
      return field ? `${field}: ${first.msg}` : String(first.msg);
    }
    if (typeof detail === 'string') return detail;
    const status = (e as { status?: number })?.status;
    if (status === 409) return 'A mechanic is already registered with these details.';
    if (status === 503) return 'Mechanic registration is not switched on yet. Please try later.';
    return 'Registration failed. Please check the details and try again.';
  }
}
