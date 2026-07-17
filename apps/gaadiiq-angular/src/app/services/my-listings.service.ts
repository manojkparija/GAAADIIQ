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
  supabaseId?: number | null;
  imageUrl?: string | null;
}

@Injectable({ providedIn: 'root' })
export class MyListingsService {
  listings = signal<MyListing[]>([]);
  loading = signal(false);

  constructor(private auth: AuthService, private sb: SupabaseService) {
    effect(() => {
      auth.currentUser(); // track dependency
      this.reload();
    });
  }

  private storageKey(): string {
    const email = this.auth.currentUser()?.email ?? 'guest';
    return `gaadiiq_listings_${email}`;
  }

  async reload() {
    const user = this.auth.currentUser();
    if (!user?.email) {
      this.listings.set([]);
      return;
    }

    this.loading.set(true);
    try {
      // Fetch from Supabase as source of truth
      const { data, error } = await this.sb.client
        .from('cars')
        .select('id, make, model, variant, year, km, fuel, transmission, owners, color, city, price, body_type, seller_email, verified, created_at, image_url')
        .eq('seller_email', user.email)
        .eq('is_seller_listing', true)
        .order('created_at', { ascending: false });

      if (!error && data && data.length > 0) {
        const remote: MyListing[] = data.map((r: any) => ({
          id: String(r.id),
          supabaseId: r.id,
          make: r.make ?? '',
          model: r.model ?? '',
          variant: r.variant ?? '',
          year: r.year ?? 0,
          km: r.km ?? 0,
          fuel: r.fuel ?? '',
          transmission: r.transmission ?? '',
          owners: r.owners ?? '',
          color: r.color ?? '',
          city: r.city ?? '',
          price: r.price ?? 0,
          description: '',
          bodyType: r.body_type ?? '',
          name: user.name ?? '',
          phone: '',
          email: r.seller_email ?? '',
          status: r.verified ? 'live' : 'pending',
          createdAt: r.created_at ?? new Date().toISOString(),
          imageUrl: r.image_url ?? null,
        }));
        // Merge: remote listings take priority; keep any local-only entries not yet in Supabase
        const local: MyListing[] = JSON.parse(localStorage.getItem(this.storageKey()) || '[]');
        const remoteIds = new Set(remote.map(r => r.supabaseId));
        const localOnly = local.filter(l => !l.supabaseId || !remoteIds.has(l.supabaseId));
        const merged = [...remote, ...localOnly];
        this.listings.set(merged);
        localStorage.setItem(this.storageKey(), JSON.stringify(merged));
        return;
      }
    } catch { /* fall through to localStorage */ }
    finally { this.loading.set(false); }

    // Fallback to localStorage if Supabase fails
    try {
      const items: MyListing[] = JSON.parse(localStorage.getItem(this.storageKey()) || '[]');
      this.listings.set(items);
    } catch {
      this.listings.set([]);
    }
  }

  add(data: Omit<MyListing, 'id' | 'status' | 'createdAt'>): MyListing {
    const listing: MyListing = {
      ...data,
      id: Date.now().toString(),
      status: 'live',
      createdAt: new Date().toISOString(),
    };
    const updated = [listing, ...this.listings()];
    localStorage.setItem(this.storageKey(), JSON.stringify(updated));
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
    localStorage.setItem(this.storageKey(), JSON.stringify(updated));
    this.listings.set(updated);
  }

  remove(id: string) {
    const listing = this.listings().find(l => l.id === id);
    if (listing?.supabaseId) {
      this.sb.client.from('cars').delete().eq('id', listing.supabaseId).then(() => {});
    }
    const updated = this.listings().filter(l => l.id !== id);
    localStorage.setItem(this.storageKey(), JSON.stringify(updated));
    this.listings.set(updated);
  }
}
