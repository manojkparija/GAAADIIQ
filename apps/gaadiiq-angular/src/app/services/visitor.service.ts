import { Injectable } from '@angular/core';

/**
 * A stable, meaningless id for one browser.
 *
 * It exists to answer one question: were these twelve views twelve people or
 * one person refreshing? Without it every signed-out view looks like a
 * different visitor, and a seller's "unique viewers" is just their page-load
 * count wearing a better name.
 *
 * WHAT IT IS NOT
 *
 * Not a tracking identifier. It is a random value the browser generates for
 * itself, stored in localStorage, never sent anywhere but this API, and never
 * joined to anything outside the two event tables. It carries no name, no
 * email, no device information, and it does not follow anyone to another site.
 * Clearing site data ends it, and nothing tries to reconstruct it afterwards.
 *
 * A signed-in viewer's own id is what the API records instead; this is only
 * for people who have not signed in.
 */
const STORAGE_KEY = 'gaadiiq_visitor';

@Injectable({ providedIn: 'root' })
export class VisitorService {
  private cached: string | null = null;

  /** The id for this browser, or null when storage is unavailable. */
  get key(): string | null {
    if (this.cached) return this.cached;

    try {
      const existing = localStorage.getItem(STORAGE_KEY);
      if (existing) {
        this.cached = existing;
        return existing;
      }
      const fresh = this.generate();
      localStorage.setItem(STORAGE_KEY, fresh);
      this.cached = fresh;
      return fresh;
    } catch {
      // Private browsing, storage disabled, or a quota error. Analytics is not
      // worth breaking a page over — the view is still recorded, just without
      // being attributable to a returning browser.
      return null;
    }
  }

  private generate(): string {
    // crypto.randomUUID is not present on older Safari, which is a meaningful
    // share of Indian mobile traffic.
    const c: Crypto | undefined = globalThis.crypto;
    if (typeof c?.randomUUID === 'function') return c.randomUUID();
    if (typeof c?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      c.getRandomValues(bytes);
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }
    return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
