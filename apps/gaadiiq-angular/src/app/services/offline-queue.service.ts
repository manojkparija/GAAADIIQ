/**
 * OfflineQueueService (MOB-030) — queues failed POST/PUT form submissions
 * and retries them automatically when connectivity is restored.
 *
 * Uses localStorage for persistence across page reloads.
 * Listens to the `online` event to drain the queue on reconnect.
 */
import { Injectable, OnDestroy, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

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
  private _onlineHandler = () => this.drainQueue();

  constructor() {
    this._loadQueue();
    window.addEventListener('online', this._onlineHandler);
    // Attempt drain on init (catches cases where SW queued items offline)
    if (navigator.onLine) this.drainQueue();
  }

  ngOnDestroy() {
    window.removeEventListener('online', this._onlineHandler);
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
    const toRetry = [...this.queue];
    this.queue = [];

    for (const req of toRetry) {
      req.attempts++;
      try {
        await firstValueFrom(
          this.http.request(req.method, req.url, {
            body: req.body,
            headers: req.headers,
          })
        );
        // Success — don't re-add
      } catch {
        if (req.attempts < MAX_ATTEMPTS) {
          this.queue.push(req);
        }
        // Drop permanently after MAX_ATTEMPTS
      }
    }
    this._saveQueue();
  }

  private _loadQueue(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.queue = raw ? JSON.parse(raw) : [];
    } catch {
      this.queue = [];
    }
  }

  private _saveQueue(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch {}
  }
}
