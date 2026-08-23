import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export type VideoReviewStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface VideoReview {
  id: string;
  car_id: string;
  car_label: string | null;
  rating: number;
  title: string | null;
  body: string | null;
  status: VideoReviewStatus;
  author_name: string | null;
  created_at: string | null;
  /** Short-lived and signed. Regenerated per response — never cache it. */
  video_url: string | null;
  review_note: string | null;
}

/** 50 MB, matching the API. Checked here too so a doomed upload fails instantly. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/**
 * Owner video reviews.
 *
 * These go through the GAADIIQ API, not through Supabase from the browser like
 * the older car_reviews path does. That difference is the point: the API can
 * check who is uploading, what the bytes actually are, how large they are and
 * how often — none of which a browser-side insert can enforce, because the
 * browser is the thing being checked.
 *
 * NOTE there is no Authorization header set here. interceptors/auth.interceptor
 * attaches the Supabase token to anything aimed at environment.apiUrl, and
 * setting one by hand shadows it.
 *
 * There is deliberately no localStorage fallback. The car_reviews service has
 * one, and it means a failed submission still reports success — the author
 * believes they have posted a review that no one else will ever see. For
 * something a person spent time recording, a clear failure is kinder than a
 * silent one.
 */
@Injectable({ providedIn: 'root' })
export class VideoReviewService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/video-reviews`;

  readonly uploading = signal(false);
  readonly progress = signal(0);

  /**
   * Submit a review. Resolves with the pending row; rejects on failure.
   *
   * Sent as multipart because the video is a file. The rating and text ride
   * along in the same request so a video can never be stored without the
   * review it belongs to — two requests would leave orphans whenever the
   * second one failed.
   */
  async submit(input: {
    carId: string;
    carLabel: string;
    rating: number;
    title: string;
    body: string;
    video: File;
  }): Promise<VideoReview> {
    const form = new FormData();
    form.append('car_id', input.carId);
    form.append('car_label', input.carLabel);
    form.append('rating', String(input.rating));
    form.append('title', input.title);
    form.append('body', input.body);
    form.append('video', input.video);

    this.uploading.set(true);
    this.progress.set(0);
    try {
      return await firstValueFrom(this.http.post<VideoReview>(this.base, form));
    } finally {
      this.uploading.set(false);
    }
  }

  /** Your own submissions, whatever their status — including why one was refused. */
  mine(): Promise<VideoReview[]> {
    return firstValueFrom(this.http.get<VideoReview[]>(`${this.base}/mine`));
  }

  /** Approved reviews for one car. The API filters; this never sees a pending row. */
  forCar(carId: string): Promise<VideoReview[]> {
    return firstValueFrom(this.http.get<VideoReview[]>(`${this.base}/car/${carId}`));
  }

  // ── Moderation (admin) ─────────────────────────────────────────────────────

  /**
   * The moderation queue for one status.
   *
   * Not pending-only. A decision has to be revisitable: an approved video that
   * turns out to be a problem needs taking down, and a rejection the author
   * disputes needs looking at again.
   */
  queue(status: VideoReviewStatus = 'pending'): Promise<VideoReview[]> {
    const params = new HttpParams().set('status_filter', status);
    return firstValueFrom(this.http.get<VideoReview[]>(`${this.base}/queue`, { params }));
  }

  /** How many sit in each state — the pending figure is the one that matters. */
  counts(): Promise<Record<VideoReviewStatus, number>> {
    return firstValueFrom(
      this.http.get<Record<VideoReviewStatus, number>>(`${this.base}/queue/counts`),
    );
  }

  approve(id: string, note = ''): Promise<VideoReview> {
    return firstValueFrom(this.http.post<VideoReview>(`${this.base}/${id}/approve`, { note }));
  }

  /** The note is required — the author is shown it, and "no" is not an answer. */
  reject(id: string, note: string): Promise<VideoReview> {
    return firstValueFrom(this.http.post<VideoReview>(`${this.base}/${id}/reject`, { note }));
  }

  remove(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${this.base}/${id}`));
  }
}
