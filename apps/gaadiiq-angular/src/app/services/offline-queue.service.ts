/**
 * OfflineQueueService (MOB-030) — queues failed POST/PUT form submissions
 * and retries them automatically when connectivity is restored.
 *
 * Uses localStorage for persistence across page reloads.
 * Listens to the `online` event to drain the queue on reconnect.
 */
import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subject, firstValueFrom } from 'rxjs';

/** A queued request that eventually reached the server, and what came back. */
export interface QueuedResult {
  url: string;
  body: unknown;
  response: unknown;
}

export interface QueuedRequest {
  id: string;
  url: string;
  method: 'POST' | 'PUT' | 'PATCH';
  body: unknown;
  headers?: Record<string, string>;
  enqueuedAt: string;
  attempts: number;
}

const STORAGE_KEY = 'gaadiiq_offline_queue';
const MAX_ATTEMPTS = 5;

@Injectable({ providedIn: 'root' })
export class OfflineQueueService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private queue: QueuedRequest[] = [];

  /** Reactive state for the offline banner (BR-UX-06). */
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly pending = signal(0);
  readonly draining = signal(false);

  /**
   * Emits when a queued request finally succeeds, carrying the response.
   *
   * The drain used to throw the response away — "Success — don't re-add" — so
   * a driver who submitted a diagnosis in a tunnel got their answer computed
   * and stored, and never saw it. Signed in, it was findable in Past
   * Diagnoses; signed out it was not findable at all.
   *
   * Additive: nothing that already used this service has to subscribe.
   */
  readonly completed = new Subject<QueuedResult>();

  /**
   * The most recent result, kept for a subscriber that was not mounted when it
   * landed. A drain that finishes while the user is on another page must not
   * be lost — the page reads this on init and clears it.
   */
  readonly lastCompleted = signal<QueuedResult | null>(null);

  /** Take the pending result, if any, and forget it. */
  takeLastCompleted(urlEndsWith: string): QueuedResult | null {
    const last = this.lastCompleted();
    if (!last || !last.url.endsWith(urlEndsWith)) return null;
    this.lastCompleted.set(null);
    return last;
  }

  private _onlineHandler = () => {
    this.online.set(true);
    void this.drainQueue();
  };
  private _offlineHandler = () => this.online.set(false);

  constructor() {
    this._loadQueue();
    window.addEventListener('online', this._onlineHandler);
    window.addEventListener('offline', this._offlineHandler);
    // Attempt drain on init (catches cases where SW queued items offline)
    if (navigator.onLine) this.drainQueue();
  }

  ngOnDestroy() {
    window.removeEventListener('online', this._onlineHandler);
    window.removeEventListener('offline', this._offlineHandler);
  }

  /** Enqueue a failed request for retry on reconnect. */
  enqueue(url: string, method: QueuedRequest['method'], body: unknown, headers?: Record<string, string>): void {
    const item: QueuedRequest = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      url, method, body, headers,
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
    };
    this.queue.push(item);
    this._saveQueue();
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  async drainQueue(): Promise<void> {
    if (this.queue.length === 0) return;
    this.draining.set(true);
    const toRetry = [...this.queue];
    this.queue = [];

    for (const req of toRetry) {
      req.attempts++;
      try {
        const response = await firstValueFrom(
          this.http.request(req.method, req.url, {
            body: req.body,
            headers: req.headers,
          })
        );
        // Success. The response is the point of the request, so hand it on:
        // the caller decides whether anything should be shown.
        const result: QueuedResult = { url: req.url, body: req.body, response };
        this.lastCompleted.set(result);
        this.completed.next(result);
      } catch {
        if (req.attempts < MAX_ATTEMPTS) {
          this.queue.push(req);
        }
        // Drop permanently after MAX_ATTEMPTS
      }
    }
    this._saveQueue();
    this.draining.set(false);
  }

  private _loadQueue(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.queue = raw ? JSON.parse(raw) : [];
    } catch {
      this.queue = [];
    }
    this.pending.set(this.queue.length);
  }

  private _saveQueue(): void {
    this.pending.set(this.queue.length);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch { /* private mode — queue is in-memory only for this session */ }
  }
}
