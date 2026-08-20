import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { ApiService, AdvisorBrief, AdvisorPick } from '../../services/api.service';
import { AnalyticsService } from '../../services/analytics.service';
import { IconComponent } from '../icon/icon.component';

/**
 * "I have ₹12 lakh, family of 5, city driving, 1,000 km/month."
 *
 * The twelve-step quiz below this box is still the right tool for a buyer who
 * does not know what they want. This is for the one who does, and it is the
 * same engine underneath — the difference is only how the requirements are
 * collected.
 *
 * Two rules the display has to keep, both of which exist because the previous
 * version of this page broke them:
 *
 *   Show what was understood. The parser can misread a sentence, and a buyer
 *   who cannot see that it read "family of 5" as five *seats* has no way to
 *   correct it before acting on the answer.
 *
 *   Show where each number came from. The old page rendered a five-year cost
 *   to the rupee out of eight hardcoded brand ratios. Every figure here
 *   carries a basis, and an estimate must never be styled like a measurement.
 */

const EXAMPLES = [
  'I have ₹12 lakh budget, family of 5, mostly city driving, 1,000 km/month',
  '₹8 lakh, first car, city, 800 km a month',
  '7 seater diesel under 20 lakh, highway, 2000 km/month',
];

/** What each `missing` key is called when we ask the buyer for it. */
const MISSING_LABELS: Record<string, string> = {
  budget: 'your budget',
  seats: 'how many people travel',
  km_per_month: 'how far you drive each month',
  usage: 'city or highway',
};

/**
 * The same labels as a field caption. Written out rather than run through
 * `titlecase`, which capitalises every word and rendered the perfectly
 * ordinary question as "How Far You Drive Each Month".
 */
const MISSING_CAPTIONS: Record<string, string> = {
  seats: 'People travelling',
  km_per_month: 'Km per month',
};

@Component({
  selector: 'app-advisor-brief',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent],
  templateUrl: './advisor-brief.component.html',
  styleUrl: './advisor-brief.component.scss',
})
export class AdvisorBriefComponent {
  private api = inject(ApiService);
  private analytics = inject(AnalyticsService);

  readonly examples = EXAMPLES;

  query = '';
  busy = signal(false);
  /** Set only when the request itself failed — never when it returned nothing. */
  error = signal('');
  result = signal<AdvisorBrief | null>(null);
  expanded = signal<Set<string>>(new Set());

  /** Answers to the follow-up questions, kept out of the sentence. */
  extraKm: number | null = null;
  extraSeats: number | null = null;

  useExample(text: string) {
    this.query = text;
    this.submit();
  }

  /**
   * A method, not a computed(). `query` is a plain field bound with ngModel,
   * and computed() tracks signal reads only — over a plain field it evaluates
   * once and then reports a stale answer forever. That has shipped twice.
   */
  canSubmit(): boolean {
    return this.query.trim().length > 2 && !this.busy();
  }

  /**
   * The follow-ups worth asking, in the order the response listed them.
   *
   * A computed() and NOT a method, unlike canSubmit() above. The difference is
   * what it reads: this derives from `result`, which is a signal, so computed()
   * tracks it correctly and — crucially — returns the *same array instance*
   * until the result actually changes.
   *
   * As a method it allocated a fresh array of fresh objects on every
   * change-detection pass, so the `*ngFor` over it destroyed and recreated its
   * views every cycle, which scheduled another cycle. The page rendered
   * forever: a browser screenshot of it timed out rather than returning.
   */
  missingPrompts = computed(() =>
    (this.result()?.missing ?? [])
      .filter(key => key === 'km_per_month' || key === 'seats')
      .map(key => ({
        key,
        label: MISSING_LABELS[key] ?? key,
        caption: MISSING_CAPTIONS[key] ?? key,
      })),
  );

  /** Fields we cannot ask about inline — they need a new sentence. */
  missingNarrative = computed(() => {
    const rest = (this.result()?.missing ?? [])
      .filter(key => key !== 'km_per_month' && key !== 'seats')
      .map(key => MISSING_LABELS[key] ?? key);
    if (!rest.length) return '';
    return rest.length === 1
      ? `Add ${rest[0]} for a sharper answer.`
      : `Add ${rest.slice(0, -1).join(', ')} and ${rest[rest.length - 1]} for a sharper answer.`;
  });

  async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.busy.set(true);
    this.error.set('');

    const text = this.query.trim();
    this.analytics.track('ai_query', { query: text, source: 'advisor_brief' });

    try {
      const body = await firstValueFrom(this.api.getAdvisorBrief({
        query: text,
        ...(this.extraKm ? { km_per_month: this.extraKm } : {}),
        ...(this.extraSeats ? { seats: this.extraSeats } : {}),
      }));
      this.result.set(body);
      this.expanded.set(new Set());
    } catch {
      // Distinct from an empty result on purpose: this one is our fault and
      // is worth trying again, where "nothing matched" is an answer.
      this.error.set('Could not reach the advisor just now. Please try again.');
      this.result.set(null);
    } finally {
      this.busy.set(false);
    }
  }

  /** Re-run with a follow-up answer supplied. */
  async answerMissing(): Promise<void> {
    if (this.extraKm === null && this.extraSeats === null) return;
    await this.submit();
  }

  toggleDetail(carId: string) {
    this.expanded.update(set => {
      const next = new Set(set);
      next.has(carId) ? next.delete(carId) : next.add(carId);
      return next;
    });
  }

  isExpanded(carId: string): boolean {
    return this.expanded().has(carId);
  }

  reset() {
    this.result.set(null);
    this.error.set('');
    this.query = '';
    this.extraKm = null;
    this.extraSeats = null;
  }

  // ── Formatting ────────────────────────────────────────────────────────────

  /**
   * Rupees in the units Indian buyers read.
   *
   * Returns an em dash rather than "₹0" for an absent figure: a zero here
   * would be read as free, and the whole point of `amount: null` is that the
   * number is not known.
   */
  money(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    if (Math.abs(value) >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`;
    if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(2)} L`;
    return `₹${Math.round(value).toLocaleString('en-IN')}`;
  }

  /** Short badge text for a cost line's provenance. */
  basisLabel(basis: string): string {
    if (basis === 'estimated') return 'Estimate';
    if (basis === 'unavailable') return 'Not known';
    return '';
  }

  /**
   * True when the five-year total is missing one or more components.
   *
   * Surfaced prominently rather than in a footnote: a partial total is lower
   * than the truth and looks complete, which is the more expensive mistake.
   */
  isPartial(pick: AdvisorPick): boolean {
    return pick.five_year_excludes.length > 0;
  }

  fuelPriceNote(): string {
    const a = this.result()?.assumptions;
    if (!a?.['fuel_prices']) return '';
    const p = a['fuel_prices'];
    return `Petrol ₹${p.petrol}/L, diesel ₹${p.diesel}/L, CNG ₹${p.cng}/kg — as at ${a['fuel_prices_as_of']}.`;
  }

  emiTermsNote(): string {
    const a = this.result()?.assumptions;
    if (!a?.['interest_pct']) return '';
    return `EMI assumes ${a['down_payment_pct']}% down at ${a['interest_pct']}% over ${Number(a['tenure_months']) / 12} years.`;
  }

  trackByCar = (_: number, pick: AdvisorPick) => pick.car_id;

  /** Keys the follow-up inputs on the field name, so typing never rebuilds them. */
  trackByKey = (_: number, prompt: { key: string }) => prompt.key;
}
