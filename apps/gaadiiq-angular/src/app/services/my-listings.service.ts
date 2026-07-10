import { Injectable, signal } from '@angular/core';
import { AuthService } from './auth.service';

export interface MyListing {
  id: string;
  make: string; model: string; variant: string; year: number;
  km: number; fuel: string; transmission: string; owners: string;
  color: string; city: string; price: number; description: string;
  bodyType: string; name: string; phone: string; email: string;
  status: 'pending' | 'live' | 'sold';
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class MyListingsService {
  listings = signal<MyListing[]>([]);

  constructor(private auth: AuthService) {
    this.reload();
    // Reload listings whenever the logged-in user changes
    (auth.currentUser as any).subscribe?.(() => this.reload());
  }

  private storageKey(): string {
    const email = this.auth.currentUser()?.email ?? 'guest';
    return `gaadiiq_listings_${email}`;
  }

  reload() {
    try {
      const items: MyListing[] = JSON.parse(localStorage.getItem(this.storageKey()) || '[]');
      this.listings.set(items.map(l => l.status === 'pending' ? { ...l, status: 'live' } : l));
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

  remove(id: string) {
    const updated = this.listings().filter(l => l.id !== id);
    localStorage.setItem(this.storageKey(), JSON.stringify(updated));
    this.listings.set(updated);
  }
}
