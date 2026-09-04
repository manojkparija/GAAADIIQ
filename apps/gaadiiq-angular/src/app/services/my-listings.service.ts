import { Injectable, signal, effect } from '@angular/core';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

export interface MyListing {
  id: string;
  make: string; model: string; variant: string; year: number;
  km: number; fuel: string; transmission: string; owners: string;
  color: string; city: string; price: number; description: string;
  bodyType: string; name: string; phone: string; email: string;
  status: 'pending' | 'live' | 'sold';
  createdAt: string;
  // A uuid, not a number: cars.id is uuid. This was declared `number`
  // while holding a string at runtime, which is what led a later change
  // to call Number() on it and get NaN.
  supabaseId?: string | null;
  imageUrl?: string | null;
}

// Single stable key — no email dependency, no key mismatch possible
const STORAGE_KEY = 'gaadiiq_my_listings';

@Injectable({ providedIn: 'root' })
export class MyListingsService {
  listings = signal<MyListing[]>([]);
  loading = signal(false);

  constructor(private auth: AuthService, private sb: SupabaseService) {
    // Load from localStorage immediately on service creation
    this.loadFromStorage();

    // When user logs in, also try to sync from Supabase.
    //
    // allowSignalWrites is load-bearing, not a lint appeasement. syncFromSupabase
    // opens with `this.loading.set(true)`, which runs synchronously inside this
    // effect — and Angular throws NG0600 ("writing to signals is not allowed")
    // for that by default. The throw happened before the query was ever issued,
    // so the sync did not merely warn: it never ran. A dealer's listings came
    // from localStorage alone, and the Inventory tab silently showed a stale or
    // empty inventory on any device that had not created them locally.
    //
    // Nothing surfaced it because the error goes to the console and the page
    // still renders — the listings just are not there, which is
    // indistinguishable from having none. Found by an e2e test watching the
    // console; e2e/dealer-dashboard.spec.ts now asserts NG0600 stays absent.
    effect(() => {
      const user = auth.currentUser();
      if (user?.email) this.syncFromSupabase(user.email);
    }, { allowSignalWrites: true });
  }

  private loadFromStorage(): void {
    try {
      // Merge from new key AND any old per-email keys
      const seen = new Set<string>();
      const all: MyListing[] = [];

      // New stable key
      const main: MyListing[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      for (const item of main) { seen.add(item.id); all.push(item); }

      // Legacy per-email keys (migrate them)
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('gaadiiq_listings_')) {
          try {
            const items: MyListing[] = JSON.parse(localStorage.getItem(k) || '[]');
            for (const item of items) {
              if (!seen.has(item.id)) { seen.add(item.id); all.push(item); }
            }
          } catch { /* ignore */ }
        }
      }

      all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (all.length > 0) {
        this.listings.set(all);
        // Migrate everything to the new stable key
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      }
    } catch { /* ignore */ }
  }

  private async syncFromSupabase(email: string): Promise<void> {
    this.loading.set(true);
    try {
      const timeout = new Promise<{ data: null; error: Error }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: new Error('timeout') }), 5000)
      );
      const query = this.sb.client
        .from('cars')
        .select('id, make, model, variant, year, km, fuel, transmission, owners, color, city, price, body_type, seller_email, verified, created_at, image_url')
        .eq('seller_email', email)
        .eq('is_seller_listing', true)
        .order('created_at', { ascending: false });

      const { data, error } = await Promise.race([query, timeout]) as any;

      if (!error && data && data.length > 0) {
        const remote: MyListing[] = data.map((r: any) => ({
          id: String(r.id),
          supabaseId: r.id,
          make: r.make ?? '', model: r.model ?? '', variant: r.variant ?? '',
          year: r.year ?? 0, km: r.km ?? 0, fuel: r.fuel ?? '',
          transmission: r.transmission ?? '', owners: r.owners ?? '',
          color: r.color ?? '', city: r.city ?? '', price: r.price ?? 0,
          description: '', bodyType: r.body_type ?? '',
          name: this.auth.currentUser()?.name ?? '', phone: '',
          email: r.seller_email ?? '',
          status: (r.verified ? 'live' : 'pending') as MyListing['status'],
          createdAt: r.created_at ?? new Date().toISOString(),
          imageUrl: r.image_url ?? null,
        }));

        // Merge: Supabase records take priority; keep local-only entries
        const local = this.listings();
        const remoteIds = new Set(remote.map(r => r.supabaseId));
        const localOnly = local.filter(l => !l.supabaseId || !remoteIds.has(l.supabaseId));
        const merged = [...remote, ...localOnly];
        merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        this.listings.set(merged);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      }
    } catch { /* keep local data */ }
    finally { this.loading.set(false); }
  }

  add(data: Omit<MyListing, 'id' | 'status' | 'createdAt'>): MyListing {
    const listing: MyListing = {
      ...data,
      id: Date.now().toString(),
      status: 'live',
      createdAt: new Date().toISOString(),
    };
    const updated = [listing, ...this.listings()];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    this.listings.set(updated);
    return listing;
  }

  async updatePrice(id: string, newPrice: number): Promise<void> {
    const listing = this.listings().find(l => l.id === id);
    if (!listing) return;
    if (listing.supabaseId) {
      await this.sb.client.from('cars').update({ price: newPrice }).eq('id', listing.supabaseId);
    }
    const updated = this.listings().map(l => l.id === id ? { ...l, price: newPrice } : l);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    this.listings.set(updated);
  }

  remove(id: string) {
    const listing = this.listings().find(l => l.id === id);
    if (listing?.supabaseId) {
      this.sb.client.from('cars').delete().eq('id', listing.supabaseId).then(() => {});
    }
    const updated = this.listings().filter(l => l.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    this.listings.set(updated);
  }

  // Keep for backward compat
  async reload(): Promise<void> {
    this.loadFromStorage();
    const email = this.auth.currentUser()?.email;
    if (email) await this.syncFromSupabase(email);
  }
}
