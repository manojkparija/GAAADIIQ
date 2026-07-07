import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface Car {
  id: number; make: string; model: string; variant?: string; year: number; price: number;
  km: number; fuel: string; transmission: string; badge: string; badgeType: string;
  image: string; images?: string[]; rating: number; reviews: number; verified: boolean;
  city?: string; bodyType?: string; color?: string; owners?: string;
  specs?: { label: string; value: string }[];
  features?: string[];
  aiValuation?: { fairPrice: number; marketMin: number; marketMax: number; verdict: string; confidence: number };
}

const LOCAL_IMAGES: Record<string, string[]> = {
  'Maruti Suzuki Swift': [
    'assets/cars/swift/front.jpg',
    'assets/cars/swift/trio.jpg',
    'assets/cars/swift/rear-motion.jpg',
    'assets/cars/swift/rear.jpg',
    'assets/cars/swift/interior.jpg',
    'assets/cars/swift/steering.jpg',
  ],
};

@Injectable({ providedIn: 'root' })
export class CarsDataService {
  private _cars = signal<Car[]>([]);
  readonly cars = this._cars.asReadonly();
  readonly loading = signal(true);

  constructor(private supabase: SupabaseService) {
    this.load();
  }

  private async load() {
    this.loading.set(true);
    const { data, error } = await this.supabase.client
      .from('cars')
      .select('*, car_specs(*), car_features(*), car_images(url, sort_order), ai_valuation(*)');

    if (error) {
      console.error('Supabase fetch error:', error);
      this.loading.set(false);
      return;
    }

    const mapped: Car[] = (data ?? []).map((row: any) => ({
      id: row.id,
      make: row.make,
      model: row.model,
      variant: row.variant,
      year: row.year,
      price: row.price,
      km: row.km,
      fuel: row.fuel,
      transmission: row.transmission,
      badge: row.badge ?? '',
      badgeType: row.badge_type ?? '',
      image: LOCAL_IMAGES[`${row.make} ${row.model}`]?.[0] || row.image || '',
      images: (() => {
        const local = LOCAL_IMAGES[`${row.make} ${row.model}`];
        if (local) return local;
        const dbImgs = row.car_images
          ? [...row.car_images].sort((a: any, b: any) => a.sort_order - b.sort_order).map((i: any) => i.url)
          : (row.image ? [row.image] : []);
        return dbImgs;
      })(),
      rating: parseFloat(row.rating) || 0,
      reviews: row.reviews ?? 0,
      verified: row.verified ?? true,
      city: row.city,
      bodyType: row.body_type,
      color: row.color,
      owners: row.owners,
      specs: row.car_specs?.map((s: any) => ({ label: s.label, value: s.value })) ?? [],
      features: row.car_features?.map((f: any) => f.feature) ?? [],
      aiValuation: row.ai_valuation?.[0]
        ? {
            fairPrice: row.ai_valuation[0].fair_price,
            marketMin: row.ai_valuation[0].market_min,
            marketMax: row.ai_valuation[0].market_max,
            verdict: row.ai_valuation[0].verdict,
            confidence: row.ai_valuation[0].confidence,
          }
        : undefined,
    }));

    this._cars.set(mapped);
    this.loading.set(false);
  }

  getAll(): Car[] { return this._cars(); }

  getById(id: number): Car | undefined { return this._cars().find(c => c.id === id); }
}
