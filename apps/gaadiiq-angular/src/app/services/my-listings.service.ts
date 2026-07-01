import { Injectable, signal } from '@angular/core';

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
  private readonly KEY = 'gaadiiq_my_listings';

  listings = signal<MyListing[]>(this.load());

  private load(): MyListing[] {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch { return []; }
  }

  add(data: Omit<MyListing, 'id' | 'status' | 'createdAt'>): MyListing {
    const listing: MyListing = {
      ...data,
      id: Date.now().toString(),
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    const updated = [listing, ...this.listings()];
    localStorage.setItem(this.KEY, JSON.stringify(updated));
    this.listings.set(updated);
    return listing;
  }

  remove(id: string) {
    const updated = this.listings().filter(l => l.id !== id);
    localStorage.setItem(this.KEY, JSON.stringify(updated));
    this.listings.set(updated);
  }
}
