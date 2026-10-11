import { Injectable, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { SupabaseService } from './supabase.service';

/** A GAADIIQ video, shown on the Reviews & News hub. */
export interface Video {
  id: string;
  /**
   * The eleven-character YouTube id, NOT a URL.
   *
   * The API refuses anything else and the Postgres column has a CHECK on the
   * shape, so by the time it reaches here it cannot carry a host, a scheme or
   * a query — which is what makes building an embed URL from it safe.
   */
  youtube_id: string;
  title: string;
  description: string | null;
  car_id: string | null;
  car_label: string | null;
  is_published: boolean;
  published_at: string | null;
}

/**
 * GAADIIQ's own videos.
 *
 * Not to be confused with VideoReviewService, which handles videos uploaded by
 * OWNERS and held in Supabase Storage behind a moderation queue. These are
 * ours, published by an admin, and hosted on YouTube.
 */
@Injectable({ providedIn: 'root' })
export class VideosService {
  private supabase = inject(SupabaseService);
  private apiUrl = environment.apiUrl;

  readonly videos = signal<Video[]>([]);
  readonly loading = signal(false);
  /**
   * True when the fetch failed, as distinct from there being nothing to show.
   * The two render identically — an empty section — and mean opposite things.
   */
  readonly failed = signal(false);

  private async authHeaders(): Promise<Record<string, string>> {
    const { data } = await this.supabase.client.auth.getSession();
    const token = data.session?.access_token ?? '';
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /**
   * @param all admin screens pass true to see unpublished rows too. The public
   *            endpoint filters on the server, so a page cannot forget to.
   */
  async load(all = false): Promise<void> {
    this.loading.set(true);
    this.failed.set(false);
    try {
      const resp = await fetch(`${this.apiUrl}/videos${all ? '/all' : ''}`, {
        headers: all ? await this.authHeaders() : {},
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this.videos.set(await resp.json());
    } catch {
      this.failed.set(true);
      this.videos.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * @returns an error message, or '' when it worked. The admin screen shows
   *          it verbatim: the API explains WHICH part of a link was wrong
   *          ("a playlist cannot be embedded as one video"), and replacing
   *          that with "Failed" would throw away the useful half.
   */
  async add(body: { url: string; title: string; description?: string;
                    car_label?: string; published_at?: string }): Promise<string> {
    try {
      const resp = await fetch(`${this.apiUrl}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await this.authHeaders()) },
        body: JSON.stringify(body),
      });
      if (resp.ok) { await this.load(true); return ''; }
      const detail = await resp.json().catch(() => null);
      return typeof detail?.detail === 'string'
        ? detail.detail
        : `Could not add the video (HTTP ${resp.status}).`;
    } catch {
      return 'Could not reach the server.';
    }
  }

  async setPublished(id: string, is_published: boolean): Promise<void> {
    await fetch(`${this.apiUrl}/videos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...(await this.authHeaders()) },
      body: JSON.stringify({ is_published }),
    });
    await this.load(true);
  }

  async remove(id: string): Promise<void> {
    await fetch(`${this.apiUrl}/videos/${id}`, {
      method: 'DELETE',
      headers: await this.authHeaders(),
    });
    await this.load(true);
  }
}

/**
 * The embed URL for a video id.
 *
 * youtube-nocookie.com, not youtube.com: the ordinary player sets Google
 * cookies the moment the iframe loads, before anyone has pressed play, which
 * is a consent question on a page a reader only came to browse. The nocookie
 * host defers that until playback. The trade is some channel analytics.
 *
 * Exported as a plain function so it can be tested without the service, and
 * so there is exactly ONE place that builds an embed URL. The id is validated
 * by the API and constrained by the database, and this function still refuses
 * anything that is not eleven safe characters — the whole value of a single
 * construction point is that the check cannot be skipped at a call site.
 */
export function youtubeEmbedUrl(youtubeId: string): string | null {
  return /^[A-Za-z0-9_-]{11}$/.test(youtubeId ?? '')
    ? `https://www.youtube-nocookie.com/embed/${youtubeId}`
    : null;
}

/** The still image for a video id, for a card that has not been opened yet. */
export function youtubeThumbnailUrl(youtubeId: string): string | null {
  return /^[A-Za-z0-9_-]{11}$/.test(youtubeId ?? '')
    ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`
    : null;
}
