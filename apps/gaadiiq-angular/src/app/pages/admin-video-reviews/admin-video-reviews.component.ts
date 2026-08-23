import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../components/icon/icon.component';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { SeoService } from '../../services/seo.service';
import {
  VideoReview,
  VideoReviewService,
  VideoReviewStatus,
} from '../../services/video-review.service';

/**
 * Deciding which owner videos buyers get to see.
 *
 * A submission sits at `pending` and nothing serves it until someone here
 * approves it. That rule lives in the API — the public read filters on
 * `approved`, and the file itself is stored privately and only handed out as a
 * short-lived signed URL. This screen is where the decision gets made, not
 * where it is enforced; the same distinction the dealer image queue draws.
 *
 * WATCH THE VIDEO BEFORE DECIDING
 *
 * The point of the queue is that a person looked. A row of Approve buttons
 * next to unplayed thumbnails is a queue that gets cleared rather than
 * reviewed, so each card embeds the actual clip and the buttons sit under it.
 *
 * REJECTION NEEDS A REASON
 *
 * The author reads it, and it is the only thing that tells them what to do
 * differently. "Rejected" alone produces a support message, not a better
 * video. The API refuses a rejection without one, so this is not the only
 * place that holds the line.
 */
@Component({
  selector: 'app-admin-video-reviews',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, TranslatePipe],
  templateUrl: './admin-video-reviews.component.html',
  styleUrl: './admin-video-reviews.component.scss',
})
export class AdminVideoReviewsComponent {
  private readonly api = inject(VideoReviewService);

  readonly tabs: { key: VideoReviewStatus; label: string }[] = [
    { key: 'pending', label: 'Waiting' },
    { key: 'approved', label: 'Published' },
    { key: 'rejected', label: 'Rejected' },
    { key: 'withdrawn', label: 'Withdrawn' },
  ];

  filter = signal<VideoReviewStatus>('pending');
  rows = signal<VideoReview[]>([]);
  counts = signal<Record<string, number>>({});
  loading = signal(false);
  error = signal<string | null>(null);

  /** The row whose rejection reason is being typed, and the text so far. */
  rejecting = signal<string | null>(null);
  reason = '';
  busy = signal<string | null>(null);

  constructor(seo: SeoService) {
    seo.setPage('Video review queue', 'Approve or reject owner-submitted video reviews.');
    this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [rows, counts] = await Promise.all([this.api.queue(this.filter()), this.api.counts()]);
      this.rows.set(rows);
      this.counts.set(counts);
    } catch {
      this.error.set('Could not load the queue. Please try again.');
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  select(status: VideoReviewStatus) {
    if (this.filter() === status) return;
    this.filter.set(status);
    this.cancelReject();
    this.load();
  }

  count(status: VideoReviewStatus): number {
    return this.counts()[status] ?? 0;
  }

  async approve(row: VideoReview) {
    this.busy.set(row.id);
    this.error.set(null);
    try {
      await this.api.approve(row.id);
      await this.load();
    } catch {
      this.error.set('Could not approve that review. Please try again.');
    } finally {
      this.busy.set(null);
    }
  }

  startReject(row: VideoReview) {
    this.rejecting.set(row.id);
    this.reason = '';
  }

  cancelReject() {
    this.rejecting.set(null);
    this.reason = '';
  }

  /**
   * A method rather than a computed(): `reason` is a plain field bound with
   * ngModel, and computed() tracks signal reads only — over a plain field it
   * evaluates once and is stale for ever. CLAUDE.md records that having
   * shipped twice.
   */
  canReject(): boolean {
    return this.reason.trim().length > 0;
  }

  async confirmReject(row: VideoReview) {
    if (!this.canReject()) return;
    this.busy.set(row.id);
    this.error.set(null);
    try {
      await this.api.reject(row.id, this.reason.trim());
      this.cancelReject();
      await this.load();
    } catch {
      this.error.set('Could not reject that review. Please try again.');
    } finally {
      this.busy.set(null);
    }
  }

  /**
   * Delete the row and the stored file.
   *
   * Offered on approved reviews too: taking something down after it has been
   * published is the case that actually matters, and a queue that can only act
   * on the untouched pile makes that a database job.
   */
  async remove(row: VideoReview) {
    this.busy.set(row.id);
    this.error.set(null);
    try {
      await this.api.remove(row.id);
      await this.load();
    } catch {
      this.error.set('Could not remove that review. Please try again.');
    } finally {
      this.busy.set(null);
    }
  }

  stars(n: number) {
    return Array.from({ length: 5 }, (_, i) => (i < n ? '★' : '☆'));
  }
}
