import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface Car {
  id: number; make: string; model: string; variant?: string; year: number; price: number;
  km: number; fuel: string; transmission: string; badge: string; badgeType: string;
  image: string; images?: string[]; rating: number; reviews: number; verified: boolean;
  city?: string; bodyType?: string; color?: string; owners?: string;
  isSellerListing?: boolean;
  sellerEmail?: string;
  specs?: { label: string; value: string }[];
  features?: string[];
  aiValuation?: { fairPrice: number; marketMin: number; marketMax: number; verdict: string; confidence: number };
}

// Fallback image URLs per model — used when the DB image URL fails to load.
// Uses a working CDN URL as primary; the onerror on <img> shows placeholder.svg.
const MODEL_IMAGE_FALLBACK: Record<string, string> = {
  'Tata Nexon':     'https://imgd.aeplcdn.com/1200x900/n/cw/ec/199321/nexon-exterior-right-front-three-quarter-2.jpeg',
  'Tata Nexon EV':  'https://imgd.aeplcdn.com/1200x900/n/cw/ec/166657/nexon-ev-exterior-right-front-three-quarter.jpeg',
};

// Fallback body-type when DB body_type column is null/empty
const MODEL_BODY_TYPE: Record<string, string> = {
  // SUVs
  'Brezza': 'SUV', 'Grand Vitara': 'SUV', 'Jimny': 'SUV',
  'Creta': 'SUV', 'Venue': 'SUV', 'Alcazar': 'SUV', 'Tucson': 'SUV',
  'Nexon': 'SUV', 'Nexon EV': 'SUV', 'Harrier': 'SUV', 'Safari': 'SUV', 'Curvv': 'SUV',
  'XUV700': 'SUV', 'XUV400': 'SUV', 'XUV300': 'SUV', 'Scorpio N': 'SUV', 'Scorpio': 'SUV',
  'Thar': 'SUV', 'Thar Roxx': 'SUV', 'BE6': 'SUV', 'XEV9e': 'SUV',
  'Seltos': 'SUV', 'Sonet': 'SUV', 'Carnival': 'SUV', 'EV6': 'SUV',
  'Fortuner': 'SUV', 'Innova Crysta': 'SUV', 'RAV4': 'SUV', 'Land Cruiser': 'SUV',
  'Kushaq': 'SUV', 'Kodiaq': 'SUV', 'Slavia': 'Sedan',
  'Hector': 'SUV', 'Hector Plus': 'SUV', 'Gloster': 'SUV', 'Windsor': 'SUV',
  'Duster': 'SUV', 'Kiger': 'SUV',
  'Jeep Compass': 'SUV', 'Jeep Meridian': 'SUV', 'Wrangler': 'SUV',
  'Astor': 'SUV', 'Atto 3': 'SUV',
  // Hatchbacks
  'Swift': 'Hatchback', 'Baleno': 'Hatchback', 'Alto K10': 'Hatchback',
  'WagonR': 'Hatchback', 'Fronx': 'Hatchback', 'S-Presso': 'Hatchback', 'Celerio': 'Hatchback',
  'i20': 'Hatchback', 'Grand i10 Nios': 'Hatchback', 'Exter': 'Hatchback',
  'Punch': 'Hatchback', 'Altroz': 'Hatchback', 'Tiago': 'Hatchback',
  'Ignis': 'Hatchback',
  // Sedans
  'Dzire': 'Sedan', 'Ciaz': 'Sedan',
  'Verna': 'Sedan', 'Aura': 'Sedan',
  'Tigor': 'Sedan', 'Tigor EV': 'Sedan',
  'Amaze': 'Sedan', 'City': 'Sedan', 'Civic': 'Sedan',
  'Rapid': 'Sedan',
  // MUVs
  'Ertiga': 'MUV', 'XL6': 'MUV',
  'Marazzo': 'MUV', 'Bolero': 'MUV',
  'Innova': 'MUV', 'Innova HyCross': 'MUV',
  'Carens': 'MUV',
};

const LOCAL_IMAGES: Record<string, string[]> = {
  'Maruti Suzuki Swift': [
    'assets/cars/swift/front.jpg',
    'assets/cars/swift/trio.jpg',
    'assets/cars/swift/rear-motion.jpg',
    'assets/cars/swift/rear.jpg',
    'assets/cars/swift/interior.jpg',
    'assets/cars/swift/steering.jpg',
  ],
  'Tata Nexon': [
    'https://imgd.aeplcdn.com/1200x900/n/cw/ec/199321/nexon-exterior-right-front-three-quarter-2.jpeg',
    'https://imgd.aeplcdn.com/1200x900/n/cw/ec/199321/nexon-exterior-right-front-three-quarter.jpeg',
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
      bodyType: row.body_type || MODEL_BODY_TYPE[row.model] || '',
      color: row.color,
      owners: row.owners,
      isSellerListing: row.is_seller_listing ?? false,
      sellerEmail: row.seller_email ?? undefined,
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
