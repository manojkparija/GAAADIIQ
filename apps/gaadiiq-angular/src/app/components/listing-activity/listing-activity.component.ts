import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ListingActivity } from '../../services/demand.service';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * How much interest a car is getting.
 *
 * The brief calls this an urgency metric, and urgency is exactly the thing
 * that must not be manufactured. "3 people are viewing this now" on a car
 * nobody has opened is the oldest trick in online retail, and a buyer who
 * catches it once stops believing anything else on the page.
 *
 * So the card shows a number only when the API says there is enough traffic to
 * support one. Below that it prints how long the car has been listed — which
 * is a fact regardless of traffic, and is the more useful half anyway: a car
 * that has sat for ninety days tells a buyer they have room to negotiate.
 */
@Component({
  selector: 'app-listing-activity',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './listing-activity.component.html',
  styleUrl: './listing-activity.component.scss',
})
export class ListingActivityComponent {
  @Input({ required: true }) activity!: ListingActivity;

  // Methods, not computed(): `activity` is a plain @Input.
  daysLabel(): string {
    const d = this.activity.days_on_market;
    if (d <= 0) return 'Listed today';
    if (d === 1) return 'Listed yesterday';
    if (d < 30) return `Listed ${d} days ago`;
    const months = Math.round(d / 30);
    return `Listed about ${months} month${months === 1 ? '' : 's'} ago`;
  }

  /**
   * A long-listed car is worth pointing out — to the buyer, whose interest it
   * serves. It is the seller's own page too, so this stays factual rather than
   * editorial: no "nobody wants this".
   */
  negotiationHint(): string | null {
    return this.activity.days_on_market >= 60
      ? 'Cars listed this long often have room to negotiate.'
      : null;
  }
}
