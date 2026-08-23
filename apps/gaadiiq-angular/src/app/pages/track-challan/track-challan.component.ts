import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../components/icon/icon.component';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { ChallanService, ChallanVerification } from '../../services/challan.service';

/**
 * Track Challan (challan BRD §11).
 *
 * Checks a vehicle's outstanding challans through GAADIIQ's authorised
 * verification source, and says plainly when it cannot.
 *
 * WHAT THIS PAGE WILL NOT DO
 *
 * It does not read echallan.parivahan.gov.in. That page is CAPTCHA-protected,
 * and driving it from a browser or a server is circumventing an access control
 * on a government portal — not an integration. The BRD rules it out in §6 for
 * the additional reason that it breaks whenever the markup changes, which
 * would strand sellers mid-listing.
 *
 * So the page does two honest things instead: it asks GAADIIQ's backend, which
 * talks to an authorised source when one is connected; and when none is, it
 * links the user to the official portal so they can solve the CAPTCHA
 * themselves. A human doing the human step is not a workaround, it is the
 * correct division of labour.
 *
 * NO RESULT IS EVER SYNTHESISED
 *
 * NIC/Parivahan access is being obtained, so today every check comes back as
 * "could not verify". The page says exactly that. It does not say "no challans
 * found", because those are different claims and only one of them is true.
 */
@Component({
  selector: 'app-track-challan',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, TranslatePipe],
  templateUrl: './track-challan.component.html',
  styleUrl: './track-challan.component.scss',
})
export class TrackChallanComponent {
  private readonly challan = inject(ChallanService);

  /** The official portal, for the seller-solves-the-CAPTCHA path. */
  readonly officialPortal = 'https://echallan.parivahan.gov.in/';

  registrationNumber = '';

  checking = signal(false);
  result = signal<ChallanVerification | null>(null);
  error = signal<string | null>(null);

  /**
   * Client-side shape check only — the backend owns validation.
   *
   * Deliberately loose. Indian plates are not one grammar: alongside
   * `SS RR XX NNNN` there are BH-series numbers that start with the year,
   * one- and two-letter series, and unpadded district codes. A strict pattern
   * would reject real vehicles, and a seller whose valid plate is refused has
   * nowhere to go. This rejects only what cannot be a plate at all; a lookup
   * that fails is reported cleanly by the source.
   *
   * A method rather than a computed(): `registrationNumber` is a plain field
   * bound with ngModel, and computed() tracks signal reads only — over a plain
   * field it evaluates once and is stale thereafter. CLAUDE.md records that
   * having shipped twice.
   */
  canCheck(): boolean {
    const cleaned = this.registrationNumber.replace(/[\s\-.]/g, '');
    return /^[A-Za-z0-9]{6,15}$/.test(cleaned) && !/^\d+$/.test(cleaned) && !/^[A-Za-z]+$/.test(cleaned);
  }

  async check(): Promise<void> {
    if (!this.canCheck() || this.checking()) return;
    this.checking.set(true);
    this.error.set(null);
    this.result.set(null);

    try {
      this.result.set(await this.challan.verify(this.registrationNumber.trim()));
    } catch {
      this.error.set(
        'We could not reach the verification service just now. Please try again in a moment.'
      );
    } finally {
      this.checking.set(false);
    }
  }

  /** True when no authorised source could answer — the state until NIC access. */
  unavailable(): boolean {
    return !!this.result()?.unavailable_reason;
  }

  reset(): void {
    this.result.set(null);
    this.error.set(null);
  }
}
