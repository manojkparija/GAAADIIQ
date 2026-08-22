import { Component, Input, inject } from '@angular/core';
import { LanguageService } from '../../services/language.service';
import { CommonModule } from '@angular/common';

import { DaysTurn } from '../../services/demand.service';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * Two ways to price the same car.
 *
 * The valuation page already showed three numbers — Distress Sale, Fair
 * Market, Premium Ask — which is most of what the brief asks for. What it did
 * not say is the thing a seller is actually deciding between: money or time.
 * Three figures on a bar do not tell anyone that the left one sells in a
 * fortnight and the right one may sit until spring.
 *
 * WHERE THE TIMINGS COME FROM
 *
 * From observed sales, or not at all. `daysTurn` is the platform's real median
 * time-to-sell; when there have been too few completed sales to have one, the
 * cards say which way each choice pushes the wait without putting a number on
 * it. "Sells in about 12 days" invented on day one is a promise the platform
 * cannot keep, and a seller who waits six weeks on it will not come back.
 *
 * The prices themselves are whatever band the caller passes in, so this adds
 * no new claim about what a car is worth — it explains a figure the page is
 * already showing.
 */

export interface PricingBand {
  low: number;
  mid: number;
  high: number;
}

export interface PricingStrategy {
  key: 'fast' | 'profit';
  title: string;
  price: number;
  timing: string;
  detail: string;
}

@Component({
  selector: 'app-pricing-strategy',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './pricing-strategy.component.html',
  styleUrl: './pricing-strategy.component.scss',
})
export class PricingStrategyComponent {
  @Input({ required: true }) band!: PricingBand;

  /** Null when unknown or when the platform has too few sales to have a median. */
  @Input() daysTurn: DaysTurn | null = null;

  private readonly lang = inject(LanguageService);
  /**
   * This component builds its copy in TypeScript rather than in a template,
   * so the `| t` pipe cannot reach it — the sentences below have to be
   * translated where they are written. The figures interpolated into them are
   * untouched; only the words around them change.
   */
  private t(s: string): string { return this.lang.translate(s); }

  // Methods rather than computed(): both are plain @Inputs.
  strategies(): PricingStrategy[] {
    const median = this.medianDays();

    return [
      {
        key: 'fast',
        // The quick-sale figure the page already shows above, not a fresh
        // interpolation. Two sets of prices for the same car on one screen is
        // how a seller stops believing either — and that is exactly what this
        // did before the tiers were given explicit meanings.
        title: this.t('Sell quickly'),
        price: this.round(this.band.low),
        timing: median
          ? `${this.t('Typically under')} ${Math.max(1, Math.round(median * 0.6))} ${this.t('days')}`
          : this.t('Fastest of the two'),
        detail: this.t(
          'Under the going rate, so yours is the cheapest comparable car a buyer '
          + 'sees. The usual choice when a deposit is due or the car has to go.'),
      },
      {
        key: 'profit',
        // The realistic private-sale figure — deliberately NOT the dealer
        // forecourt price above it. A private seller cannot reach that one: it
        // buys a warranty, reconditioning and a showroom they do not have.
        title: this.t('Get the most for it'),
        price: this.round(this.band.mid),
        timing: median
          ? `${this.t('Often')} ${Math.round(median * 1.5)} ${this.t('days or more')}`
          : this.t('Expect a longer wait'),
        detail: this.t(
          'The full private-sale price, which means waiting for the buyer who '
          + 'wants exactly this car. Worth it when there is no deadline.'),
      },
    ];
  }

  /** The gap between the two, which is what the decision is actually about. */
  spread(): number {
    const [fast, profit] = this.strategies();
    return profit.price - fast.price;
  }

  /**
   * Whether the timings above are grounded in anything.
   *
   * Drives the note on the card. Without it a seller cannot tell a measured
   * median from a figure of speech, and the two deserve different trust.
   */
  hasObservedTimings(): boolean {
    return this.medianDays() !== null;
  }

  sampleSize(): number {
    return this.daysTurn?.sample_size ?? 0;
  }

  rupees(value: number): string {
    return '₹' + Math.round(value).toLocaleString('en-IN');
  }

  private medianDays(): number | null {
    const t = this.daysTurn;
    return t && t.has_enough_data && t.median_days ? t.median_days : null;
  }

  /** To the nearest thousand — nobody advertises a car at ₹5,47,318. */
  private round(value: number): number {
    return Math.round(value / 1000) * 1000;
  }
}
