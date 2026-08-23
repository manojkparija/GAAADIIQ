import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { IconComponent } from '../../components/icon/icon.component';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { CityService } from '../../services/city.service';
import { LanguageService } from '../../services/language.service';
import {
  InsuranceInterestRequest,
  InsuranceService,
} from '../../services/insurance.service';

/**
 * Car insurance (BRD §6).
 *
 * WHAT THIS PAGE IS, GIVEN THAT THERE IS NO PARTNER
 *
 * The BRD describes a page that quotes, compares and sells. None of that can
 * happen until a regulated partner is onboarded, which is scheduled after the
 * production release. So the page does the two things that are real today:
 *
 *   1. It explains. IDV, NCB, own-damage vs third-party, and what the add-ons
 *      actually cover are the questions people search for before buying, and
 *      answering them needs no partner and no licence. This is the majority of
 *      the page and it is not filler — it is the part a buyer needs most and
 *      the part most insurance sites bury under a quote form.
 *   2. It captures interest, with consent and a policy expiry date.
 *
 * WHAT IT DOES NOT DO
 *
 * There is no premium on this page, no "starting from", no estimate, and no
 * IDV calculator. A number here would be invented, and an invented premium is
 * indistinguishable from a real one to the person reading it. The API refuses
 * to generate one (routers/insurance.py) and this page does not work around
 * that refusal — see services/insurance.service.ts.
 *
 * The single hardest thing to keep out of a page like this is a plausible
 * number, because the page looks empty without one. It is not empty; it
 * answers questions. A wrong price would be worse than a quiet page.
 */

interface Explainer {
  id: string;
  icon: string;
  term: string;
  short: string;
  body: string[];
}

@Component({
  selector: 'app-insurance',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, TranslatePipe],
  templateUrl: './insurance.component.html',
  styleUrl: './insurance.component.scss',
})
export class InsuranceComponent {
  private readonly insurance = inject(InsuranceService);
  private readonly route = inject(ActivatedRoute);
  readonly city = inject(CityService);
  readonly lang = inject(LanguageService);

  /**
   * Cover types, described by what they pay for rather than by name.
   *
   * "Third-party" is a legal category, not an explanation, and the single most
   * common misunderstanding in Indian motor insurance is that it covers your
   * own car. The wording below leads with what is and is not paid for.
   */
  readonly coverTypes = [
    {
      id: 'comprehensive',
      icon: 'shield',
      name: 'Comprehensive',
      summary: 'Covers damage to your own car as well as to others.',
      detail:
        'Pays for repairs to your car after an accident, and for theft, fire ' +
        'and natural disasters — plus everything third-party cover includes. ' +
        'This is what most people mean by "full" insurance.',
    },
    {
      id: 'third_party',
      icon: 'users',
      name: 'Third-Party',
      summary: 'The legal minimum. Does NOT cover your own car.',
      detail:
        'Required by law to drive on Indian roads. It pays for injury or ' +
        'damage you cause to other people and their property. It pays ' +
        'nothing towards repairing your own car, however the accident ' +
        'happened.',
    },
    {
      id: 'own_damage',
      icon: 'wrench',
      name: 'Own Damage',
      summary: 'Covers your car only. Bought alongside third-party cover.',
      detail:
        'Covers repairs to your own car, and is bought in addition to a ' +
        'separate third-party policy rather than instead of one. Useful if ' +
        'your third-party cover still has time left on it.',
    },
  ];

  /**
   * The terms that decide what someone actually pays and receives.
   *
   * Every one of these is a real, checkable definition. None of them is a
   * number about a specific vehicle — the difference between "IDV is your
   * car's insured value, set by the insurer" (true, useful) and "your IDV is
   * ₹5,40,000" (invented).
   */
  readonly explainers: Explainer[] = [
    {
      id: 'idv',
      icon: 'indian-rupee',
      term: 'IDV',
      short: 'Insured Declared Value — the most a claim can pay out.',
      body: [
        'IDV is the value your insurer puts on your car for the policy year. ' +
          'It is the maximum they will pay if the car is stolen or written off.',
        'It is set by the insurer from the manufacturer\'s listed price minus ' +
          'depreciation for the car\'s age — not by you, and not by GAADIIQ.',
        'A lower IDV means a lower premium and a smaller payout. Choosing the ' +
          'lowest IDV on offer to save on the premium is the trade people ' +
          'most often regret making.',
      ],
    },
    {
      id: 'ncb',
      icon: 'trending-up',
      term: 'NCB',
      short: 'No Claim Bonus — a discount for years without a claim.',
      body: [
        'Each policy year you do not claim, your renewal discount rises: 20% ' +
          'after the first year, then 25%, 35%, 45% and 50% after five.',
        'The bonus belongs to you, not to the car. It moves with you when you ' +
          'sell and buy another, provided you transfer it in time.',
        'One claim resets it. This is why a small claim can cost more over the ' +
          'following years than paying for the repair yourself.',
      ],
    },
    {
      id: 'deductible',
      icon: 'scissors',
      term: 'Deductible',
      short: 'The part of every claim you pay yourself.',
      body: [
        'Also called the excess. A compulsory deductible is fixed by ' +
          'regulation and depends on engine size; you can agree to a higher ' +
          'voluntary one in exchange for a lower premium.',
        'It applies to each claim, not each year.',
      ],
    },
  ];

  /**
   * Add-ons, with what they cover and — more usefully — when they are not
   * worth buying. An add-on list that only says yes is advertising.
   */
  readonly addOns = [
    {
      name: 'Zero Depreciation',
      covers: 'Pays the full cost of replaced parts, without deducting for age.',
      whenNot: 'Rarely offered, and rarely worth it, on cars older than about five years.',
    },
    {
      name: 'Engine Protection',
      covers: 'Covers engine damage from water ingress or oil leakage.',
      whenNot: 'Least useful if you never park or drive where water collects.',
    },
    {
      name: 'Roadside Assistance',
      covers: 'Towing, jump-starts, flat tyres and lockouts.',
      whenNot: 'Often already included with a new car\'s warranty package.',
    },
    {
      name: 'Return to Invoice',
      covers: 'Pays the original invoice price if the car is stolen or written off, not the depreciated IDV.',
      whenNot: 'Only meaningful in the first few years, while invoice and IDV still differ a lot.',
    },
    {
      name: 'Consumables Cover',
      covers: 'Pays for oils, coolant, nuts and bolts, which a standard claim excludes.',
      whenNot: 'A small sum on most claims; worth it mainly on expensive cars.',
    },
  ];

  // ── The interest form ──────────────────────────────────────────────────────

  readonly form: InsuranceInterestRequest = {
    make: '',
    model: '',
    manufacturing_year: null,
    fuel_type: null,
    registration_no: null,
    city: null,
    existing_policy_expiry: null,
    existing_insurer: null,
    name: null,
    phone: '',
    email: null,
    consent: false,
  };

  readonly fuels = ['petrol', 'diesel', 'electric', 'cng', 'hybrid'];

  submitting = signal(false);
  submitted = signal(false);
  error = signal<string | null>(null);

  constructor() {
    // /insurance?intent=renew scrolls straight to the form, since somebody
    // arriving from "Renew Insurance" has already decided.
    this.route.queryParamMap.subscribe(params => {
      if (params.get('intent') === 'renew') {
        queueMicrotask(() => document.getElementById('enquiry')?.scrollIntoView());
      }
    });
    this.form.city = this.city.selectedCity() || null;
  }

  /**
   * Deliberately a method, not a computed().
   *
   * The fields it reads are plain properties bound with ngModel, and
   * computed() tracks signal reads only — over a plain field it evaluates once
   * and then reports a stale answer forever. CLAUDE.md records this having
   * shipped twice.
   */
  canSubmit(): boolean {
    return (
      this.form.make.trim().length > 0 &&
      this.form.model.trim().length > 0 &&
      /^\+91[6-9]\d{9}$/.test(this.form.phone.trim()) &&
      this.form.consent
    );
  }

  async submit(): Promise<void> {
    if (!this.canSubmit() || this.submitting()) return;
    this.submitting.set(true);
    this.error.set(null);

    try {
      await this.insurance.registerInterest({
        ...this.form,
        make: this.form.make.trim(),
        model: this.form.model.trim(),
        phone: this.form.phone.trim(),
      });
      this.submitted.set(true);
    } catch {
      this.error.set(
        'We could not record your details just now. Please try again in a moment.'
      );
    } finally {
      this.submitting.set(false);
    }
  }
}
