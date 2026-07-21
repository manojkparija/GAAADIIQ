/**
 * WishlistService — persists wishlisted listing IDs to Supabase when the user
 * is logged in; falls back to localStorage for guests.
 * Fixes MOB-017: wishlist no longer lost on reinstall for authenticated users.
 */
import { Injectable, signal, computed, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

const LS_KEY = 'gaadiiq_wishlist';

@Injectable({ providedIn: 'root' })
export class WishlistService {
  private readonly auth    = inject(AuthService);
  private readonly supa    = inject(SupabaseService);

  private readonly _ids = signal<Set<string>>(new Set());

  readonly ids     = computed(() => this._ids());
  readonly count   = computed(() => this._ids().size);

  constructor() {
    // Seed from localStorage immediately; hydrate from Supabase if logged in
    this._seedFromLocal();
    // Re-sync whenever auth state changes
    this.auth.currentUser; // touch signal so we can use effect-free polling
    this._hydrate();
  }

  isLiked(id: string) { return this._ids().has(id); }

  async toggle(listingId: string): Promise<void> {
    const current = new Set(this._ids());
    if (current.has(listingId)) {
      current.delete(listingId);
      await this._remove(listingId);
    } else {
      current.add(listingId);
      await this._add(listingId);
    }
    this._ids.set(current);
    this._persistLocal(current);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _seedFromLocal() {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) this._ids.set(new Set(JSON.parse(stored) as string[]));
    } catch { /* ignore */ }
  }

  private _persistLocal(ids: Set<string>) {
    try { localStorage.setItem(LS_KEY, JSON.stringify([...ids])); } catch { /* ignore */ }
  }

  private async _hydrate() {
    const user = this.auth.currentUser();
    if (!user) return;
    const { data } = await this.supa.client
      .from('wishlists')
      .select('listing_id')
      .eq('user_id', user.id);
    if (data) {
      const remoteIds = new Set(data.map((r: any) => r.listing_id as string));
      // Merge with local (local additions while offline survive)
      const merged = new Set([...this._ids(), ...remoteIds]);
      this._ids.set(merged);
      this._persistLocal(merged);
    }
  }

  private async _add(listingId: string) {
    const user = this.auth.currentUser();
    if (!user) return;
    await this.supa.client
      .from('wishlists')
      .upsert({ user_id: user.id, listing_id: listingId }, { onConflict: 'user_id,listing_id' });
  }

  private async _remove(listingId: string) {
    const user = this.auth.currentUser();
    if (!user) return;
    await this.supa.client
      .from('wishlists')
      .delete()
      .eq('user_id', user.id)
      .eq('listing_id', listingId);
  }
}
