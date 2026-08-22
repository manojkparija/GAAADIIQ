import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MarketPosition } from '../../utils/market-position';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * The price gauge on a used-car page.
 *
 * A buyer's first question about a used car is whether the asking price is
 * fair, and the page answered it with nothing — the number sat on its own with
 * no reference point. Sellers already saw this verdict on /my-listings; this
 * is the same judgement, from the same engine, shown to the side of the
 * transaction that needs it more.
 *
 * The band and its source are printed rather than hidden behind the verdict.
 * "18% above market" is a strong claim, and a buyer is entitled to see the
 * range it came from and how confident the estimate is before acting on it.
 */
@Component({
  selector: 'app-market-position',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './market-position.component.html',
  styleUrl: './market-position.component.scss',
})
export class MarketPositionComponent {
  @Input({ required: true }) position!: MarketPosition;
  @Input({ required: true }) askingPrice = 0;

  // Methods rather than computed(): `position` is a plain @Input, and a
  // computed() over a non-signal evaluates once and then reports a stale
  // answer for every car after the first.
  statusClass(): string {
    return `mp-${this.position.status}`;
  }

  /** ₹8,45,000 — the Indian grouping, which toLocaleString gets right. */
  rupees(value: number): string {
    return '₹' + Math.round(value).toLocaleString('en-IN');
  }
}
