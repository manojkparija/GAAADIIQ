import { Injectable, signal } from '@angular/core';

import { SupabaseService } from './supabase.service';
import { ImageReviewStatus } from './dealer-car-images.service';

/**
 * The admin queue for dealer-submitted photographs.
 *
 * From UAT: a dealer's image must not become publicly visible on upload. The
 * gate itself is in the database — a buyer's read policy matches only
 * `status = 'approved'`, and a trigger refuses a status change from anyone who
 * is not an admin. This service is the screen for it, not the enforcement:
 * disabling it in the browser would not publish a single pending image.
 *
 * That split is deliberate. A review queue whose rules live in the client is a
 * suggestion.
 */

export interface ReviewableImage {
  id: number;
  car_id: string;
  url: string;
  status: ImageReviewStatus;
  rejection_reason: string | null;
  submitted_by: string | null;
  created_at: string;
  /** Joined for context: an admin cannot judge a photo without the car. */
  cars?: { make: string; model: string; year: number; seller_email: string } | null;
}

@Injectable({ providedIn: 'root' })
export class ImageReviewService {
  images = signal<ReviewableImage[]>([]);
  loading = signal(false);
  error = signal('');

  constructor(private sb: SupabaseService) {}

  async load(status: ImageReviewStatus = 'pending'): Promise<void> {
    this.loading.set(true);
    this.error.set('');

    const { data, error } = await this.sb.client
      .from('car_images')
      .select('id, car_id, url, status, rejection_reason, submitted_by, created_at, '
            + 'cars(make, model, year, seller_email)')
      .eq('status', status)
      // Oldest first: a queue people work from the front of, so nothing waits
      // indefinitely because newer submissions keep arriving on top.
      .order('created_at', { ascending: true });

    this.loading.set(false);
    if (error) {
      this.error.set('Could not load the review queue.');
      this.images.set([]);
      return;
    }
    this.images.set((data ?? []) as unknown as ReviewableImage[]);
  }

  approve(id: number): Promise<boolean> {
    return this.decide(id, { status: 'approved', rejection_reason: null });
  }

  /**
   * Reject, with a reason the dealer will read.
   *
   * The reason is required here as well as in the database, so the admin is
   * told before the round trip rather than after. The database constraint is
   * the one that counts.
   */
  reject(id: number, reason: string): Promise<boolean> {
    const trimmed = reason.trim();
    if (!trimmed) {
      this.error.set('Give a reason — the dealer sees it and has to act on it.');
      return Promise.resolve(false);
    }
    return this.decide(id, { status: 'rejected', rejection_reason: trimmed });
  }

  private async decide(
    id: number,
    change: { status: ImageReviewStatus; rejection_reason: string | null },
  ): Promise<boolean> {
    this.error.set('');

    // reviewed_by and reviewed_at are deliberately not sent: the database
    // stamps them from the caller's own token, so the record of who decided
    // cannot be written by whoever is asking.
    const { data, error } = await this.sb.client
      .from('car_images')
      .update(change)
      .eq('id', id)
      .select('id');

    // Row-level security refuses by returning nothing rather than raising, so
    // a check on `error` alone would report success for a refused write.
    if (error || !data?.length) {
      this.error.set('That decision could not be saved.');
      return false;
    }

    // Dropped from the queue rather than reloaded: the admin is working
    // through a list, and having it jump under them after every decision is
    // how rows get skipped.
    this.images.update(list => list.filter(i => i.id !== id));
    return true;
  }
}
