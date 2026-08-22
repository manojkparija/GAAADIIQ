import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { VehicleScore } from '../../utils/market-position';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * The condition score on a used-car page.
 *
 * Deliberately titled "Condition score", not "Vehicle health score". The brief
 * asked for a 1–100 score over accident history, owner count and service
 * records; this codebase holds exactly one of those three. A number badged as
 * a health score, with a history report implied behind it, is a claim the site
 * cannot stand behind — and a buyer has no way to tell the difference at the
 * point they read it.
 *
 * So every factor is shown with the reading it came from, and what the score
 * could not see is printed on the card rather than buried in a tooltip.
 */
@Component({
  selector: 'app-vehicle-scorecard',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './vehicle-scorecard.component.html',
  styleUrl: './vehicle-scorecard.component.scss',
})
export class VehicleScorecardComponent {
  @Input({ required: true }) score!: VehicleScore;

  // Methods, not computed() — `score` is a plain @Input and a computed() over
  // a non-signal would freeze on the first car rendered.
  gradeClass(): string {
    return 'vs-' + this.score.grade.toLowerCase().replace(/\s+/g, '-');
  }

  barClass(factorScore: number): string {
    return factorScore >= 80 ? 'vs-bar-good'
      : factorScore >= 55 ? 'vs-bar-mid'
      : 'vs-bar-low';
  }

  /** Circumference of the ring, for the stroke-dash trick. r=52. */
  readonly ringLength = 2 * Math.PI * 52;

  ringOffset(): number {
    return this.ringLength * (1 - this.score.score / 100);
  }
}
