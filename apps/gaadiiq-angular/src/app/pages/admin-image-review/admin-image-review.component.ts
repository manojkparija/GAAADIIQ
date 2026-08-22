import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ImageReviewService, ReviewableImage } from '../../services/image-review.service';
import { ImageReviewStatus } from '../../services/dealer-car-images.service';
import { SeoService } from '../../services/seo.service';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * Deciding which dealer photographs buyers get to see.
 *
 * From UAT: a dealer upload must sit in Pending until an admin passes it. The
 * rule is enforced in the database — buyers read only `status = 'approved'`,
 * and a trigger refuses a status change from anyone who is not an admin. This
 * screen is where the decision gets made, not where it is enforced.
 *
 * Rejection requires a reason because the dealer reads it and has to act on
 * it. "Rejected" with no explanation is a dead end that produces a support
 * message rather than a better photograph.
 */
@Component({
  selector: 'app-admin-image-review',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './admin-image-review.component.html',
  styleUrl: './admin-image-review.component.scss',
})
export class AdminImageReviewComponent {
  images = this.review.images;
  loading = this.review.loading;
  error = this.review.error;

  /** Which queue is on screen. Rejected is included so a decision can be revisited. */
  filter = signal<ImageReviewStatus>('pending');

  /** The row whose rejection reason is being typed, and the text so far. */
  rejecting = signal<number | null>(null);
  reason = signal('');
  busy = signal<number | null>(null);

  constructor(private review: ImageReviewService, seo: SeoService) {
    seo.setPage('Image Review', 'Approve or reject dealer-submitted vehicle photographs.');
    void this.review.load('pending');
  }

  show(status: ImageReviewStatus) {
    this.filter.set(status);
    this.cancelReject();
    void this.review.load(status);
  }

  carLabel(img: ReviewableImage): string {
    const c = img.cars;
    if (!c) return 'Unknown vehicle';
    return `${c.year} ${c.make} ${c.model}`;
  }

  async approve(img: ReviewableImage) {
    this.busy.set(img.id);
    await this.review.approve(img.id);
    this.busy.set(null);
  }

  startReject(img: ReviewableImage) {
    this.rejecting.set(img.id);
    this.reason.set('');
  }

  cancelReject() {
    this.rejecting.set(null);
    this.reason.set('');
  }

  async confirmReject(img: ReviewableImage) {
    this.busy.set(img.id);
    const ok = await this.review.reject(img.id, this.reason());
    this.busy.set(null);
    if (ok) this.cancelReject();
  }
}
