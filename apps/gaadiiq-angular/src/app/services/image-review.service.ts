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
    //
    // `status` is read back, not just `id`. Selecting the key alone answers
    // "did a row come back", which is not the question — it is possible for
    // the statement to return a row whose status is not what was asked for,
    // and that reads as success. Production showed exactly that shape: both
    // images carried reviewed_by and reviewed_at (so the write path and the
    // admin check were working) while status had never once been 'rejected'.
    const { data, error } = await this.sb.client
      .from('car_images')
      .update(change)
      .eq('id', id)
      .select('id, status, rejection_reason');

    // Row-level security refuses by returning nothing rather than raising, so
    // a check on `error` alone would report success for a refused write.
    if (error) {
      // Say what the database said.
      //
      // This used to read 'That decision could not be saved.' and discard
      // `error` entirely — the same defect the listing form had, where a
      // fixed string turned a one-line fix into a support conversation.
      // Postgres names the constraint, the policy or the column; showing it
      // costs nothing.
      const code = error.code ? ` [${error.code}]` : '';
      this.error.set(
        `That decision could not be saved${code}: ${error.message || error}`);
      return false;
    }

    if (!data?.length) {
      // No error and no row is what row-level security looks like: the
      // statement ran and matched nothing the caller is allowed to change.
      this.error.set(
        'That decision was refused — the row was not updated. This is a '
        + 'permissions problem, not something retrying will fix.');
      return false;
    }

    const saved = data[0] as { status: ImageReviewStatus };
    if (saved.status !== change.status) {
      // The write returned a row, but not the one asked for. Silence here is
      // how a rejection that never happened looked like one that did.
      this.error.set(
        `The database kept this image as "${saved.status}" instead of `
        + `"${change.status}". The decision was not applied.`);
      return false;
    }

    // Dropped from the queue rather than reloaded: the admin is working
    // through a list, and having it jump under them after every decision is
    // how rows get skipped.
    this.images.update(list => list.filter(i => i.id !== id));
    return true;
  }
}
