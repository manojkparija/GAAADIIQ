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

const DEMO_NEW_CARS: Car[] = [
  { id: 8001, make: 'Maruti Suzuki', model: 'Swift', variant: 'ZXi+', year: 2025, price: 899000, km: 0, fuel: 'Petrol', transmission: 'AMT', badge: 'Bestseller', badgeType: 'featured', image: 'assets/cars/swift/front.jpg', images: ['assets/cars/swift/front.jpg'], rating: 4.4, reviews: 312, verified: true, city: 'Mumbai', bodyType: 'Hatchback', specs: [{ label: 'Mileage', value: '24.8 kmpl' }, { label: 'Power', value: '81 bhp' }], features: ['Sunroof', '6 Airbags', 'Connected Car', 'Wireless Charging'] },
  { id: 8002, make: 'Hyundai', model: 'Creta', variant: 'SX Tech', year: 2025, price: 1695000, km: 0, fuel: 'Petrol', transmission: 'Automatic', badge: 'Top Rated', badgeType: 'featured', image: 'assets/cars/placeholder.svg', images: [], rating: 4.6, reviews: 210, verified: true, city: 'Delhi', bodyType: 'SUV', specs: [{ label: 'Mileage', value: '17.4 kmpl' }, { label: 'Power', value: '138 bhp' }], features: ['Panoramic Sunroof', 'ADAS Safety', '360° Camera', '6 Airbags', 'Ventilated Seats', 'Wireless Charging'] },
  { id: 8003, make: 'Tata', model: 'Nexon EV', variant: 'Max LR', year: 2025, price: 2099000, km: 0, fuel: 'Electric', transmission: 'Automatic', badge: 'Best EV', badgeType: 'featured', image: 'assets/cars/placeholder.svg', images: [], rating: 4.5, reviews: 175, verified: true, city: 'Bengaluru', bodyType: 'SUV', specs: [{ label: 'Range', value: '465 km' }, { label: 'Power', value: '143 bhp' }], features: ['Panoramic Sunroof', '6 Airbags', 'Connected Car', 'ADAS Safety', 'Wireless Charging'] },
  { id: 8004, make: 'Maruti Suzuki', model: 'Grand Vitara', variant: 'Alpha+', year: 2025, price: 1899000, km: 0, fuel: 'Hybrid', transmission: 'Automatic', badge: 'Eco', badgeType: 'featured', image: 'assets/cars/placeholder.svg', images: [], rating: 4.5, reviews: 98, verified: true, city: 'Pune', bodyType: 'SUV', specs: [{ label: 'Mileage', value: '27.97 kmpl' }, { label: 'Power', value: '115 bhp' }], features: ['Sunroof', '6 Airbags', 'Connected Car', 'Wireless Charging', 'Ventilated Seats'] },
  { id: 8005, make: 'Mahindra', model: 'XUV700', variant: 'AX7 AWD', year: 2025, price: 2799000, km: 0, fuel: 'Diesel', transmission: 'Automatic', badge: 'Premium', badgeType: 'featured', image: 'assets/cars/placeholder.svg', images: [], rating: 4.6, reviews: 144, verified: true, city: 'Hyderabad', bodyType: 'SUV', specs: [{ label: 'Mileage', value: '16.1 kmpl' }, { label: 'Power', value: '182 bhp' }], features: ['Panoramic Sunroof', 'ADAS Safety', '360° Camera', '6 Airbags', 'Ventilated Seats', 'Connected Car', 'Large Touchscreen'] },
  { id: 8006, make: 'Toyota', model: 'Innova HyCross', variant: 'VX Hybrid', year: 2025, price: 2500000, km: 0, fuel: 'Hybrid', transmission: 'Automatic', badge: 'Family', badgeType: 'featured', image: 'assets/cars/placeholder.svg', images: [], rating: 4.7, reviews: 92, verified: true, city: 'Chennai', bodyType: 'MUV', specs: [{ label: 'Mileage', value: '21.1 kmpl' }, { label: 'Power', value: '186 bhp' }], features: ['Sunroof', '6 Airbags', 'Connected Car', 'Wireless Charging', 'Ventilated Seats'] },
  { id: 8007, make: 'Kia', model: 'Seltos', variant: 'GTX+ DCT', year: 2025, price: 2000000, km: 0, fuel: 'Petrol', transmission: 'DCT', badge: 'Sporty', badgeType: 'featured', image: 'assets/cars/placeholder.svg', images: [], rating: 4.5, reviews: 138, verified: true, city: 'Jaipur', bodyType: 'SUV', specs: [{ label: 'Mileage', value: '16.5 kmpl' }, { label: 'Power', value: '138 bhp' }], features: ['Panoramic Sunroof', 'ADAS Safety', '360° Camera', '6 Airbags', 'Connected Car', 'Wireless Charging'] },
  { id: 8008, make: 'Hyundai', model: 'Venue', variant: 'SX+ iMT', year: 2025, price: 1299000, km: 0, fuel: 'Petrol', transmission: 'iMT', badge: 'Value', badgeType: 'featured', image: 'assets/cars/placeholder.svg', images: [], rating: 4.3, reviews: 187, verified: true, city: 'Ahmedabad', bodyType: 'SUV', specs: [{ label: 'Mileage', value: '18.15 kmpl' }, { label: 'Power', value: '118 bhp' }], features: ['Sunroof', '6 Airbags', 'Connected Car', 'Wireless Charging'] },
  { id: 8009, make: 'Tata', model: 'Punch', variant: 'Accomplished+', year: 2025, price: 899000, km: 0, fuel: 'CNG', transmission: 'Manual', badge: 'Eco Value', badgeType: 'featured', image: 'assets/cars/placeholder.svg', images: [], rating: 4.2, reviews: 204, verified: true, city: 'Kolkata', bodyType: 'Hatchback', specs: [{ label: 'Mileage', value: '26.49 km/kg' }, { label: 'Power', value: '72 bhp' }], features: ['6 Airbags', 'Connected Car'] },
  { id: 8010, make: 'Maruti Suzuki', model: 'Ertiga', variant: 'ZXi+', year: 2025, price: 1199000, km: 0, fuel: 'CNG', transmission: 'Manual', badge: 'Family', badgeType: 'featured', image: 'assets/cars/placeholder.svg', images: [], rating: 4.4, reviews: 156, verified: true, city: 'Delhi', bodyType: 'MUV', specs: [{ label: 'Mileage', value: '26.11 km/kg' }, { label: 'Power', value: '87 bhp' }], features: ['Sunroof', '6 Airbags'] },
];

const DEMO_USED_CARS: Car[] = [
  { id: 9001, make: 'Maruti Suzuki', model: 'Swift', variant: 'VXi', year: 2020, price: 550000, km: 42000, fuel: 'Petrol', transmission: 'Manual', badge: 'Popular', badgeType: 'featured', image: 'assets/cars/swift/front.jpg', images: ['assets/cars/swift/front.jpg'], rating: 4.3, reviews: 128, verified: true, city: 'Mumbai', bodyType: 'Hatchback', color: 'White', owners: '1st Owner' },
  { id: 9002, make: 'Hyundai', model: 'Creta', variant: 'SX', year: 2021, price: 1150000, km: 28000, fuel: 'Petrol', transmission: 'Automatic', badge: 'Verified', badgeType: 'featured', image: 'assets/cars/placeholder.svg', images: [], rating: 4.5, reviews: 95, verified: true, city: 'Bengaluru', bodyType: 'SUV', color: 'Grey', owners: '1st Owner' },
  { id: 9003, make: 'Tata', model: 'Nexon', variant: 'XZ+', year: 2022, price: 1080000, km: 18500, fuel: 'Petrol', transmission: 'Manual', badge: 'Low KM', badgeType: 'featured', image: 'assets/cars/placeholder.svg', images: [], rating: 4.4, reviews: 72, verified: true, city: 'Delhi', bodyType: 'SUV', color: 'Blue', owners: '1st Owner' },
  { id: 9004, make: 'Honda', model: 'City', variant: 'ZX CVT', year: 2019, price: 820000, km: 61000, fuel: 'Petrol', transmission: 'CVT', badge: '', badgeType: '', image: 'assets/cars/placeholder.svg', images: [], rating: 4.2, reviews: 56, verified: false, city: 'Pune', bodyType: 'Sedan', color: 'Silver', owners: '2nd Owner' },
  { id: 9005, make: 'Mahindra', model: 'XUV700', variant: 'AX7 4WD', year: 2022, price: 2100000, km: 22000, fuel: 'Diesel', transmission: 'Automatic', badge: 'Premium', badgeType: 'featured', image: 'assets/cars/placeholder.svg', images: [], rating: 4.6, reviews: 43, verified: true, city: 'Hyderabad', bodyType: 'SUV', color: 'Black', owners: '1st Owner' },
  { id: 9006, make: 'Toyota', model: 'Innova Crysta', variant: 'GX MT', year: 2020, price: 1350000, km: 55000, fuel: 'Diesel', transmission: 'Manual', badge: '', badgeType: '', image: 'assets/cars/placeholder.svg', images: [], rating: 4.4, reviews: 88, verified: true, city: 'Chennai', bodyType: 'MUV', color: 'White', owners: '2nd Owner' },
  { id: 9007, make: 'Maruti Suzuki', model: 'Baleno', variant: 'Alpha', year: 2021, price: 690000, km: 33000, fuel: 'Petrol', transmission: 'Automatic', badge: '', badgeType: '', image: 'assets/cars/placeholder.svg', images: [], rating: 4.3, reviews: 61, verified: true, city: 'Ahmedabad', bodyType: 'Hatchback', color: 'Red', owners: '1st Owner' },
  { id: 9008, make: 'Kia', model: 'Seltos', variant: 'HTX+ DCT', year: 2021, price: 1280000, km: 31000, fuel: 'Petrol', transmission: 'DCT', badge: 'Certified', badgeType: 'featured', image: 'assets/cars/placeholder.svg', images: [], rating: 4.5, reviews: 77, verified: true, city: 'Jaipur', bodyType: 'SUV', color: 'Brown', owners: '1st Owner' },
];

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
      this._cars.set([...DEMO_NEW_CARS, ...DEMO_USED_CARS]);
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

    const hasUsedCars = mapped.some(c => c.isSellerListing || c.km > 0 || c.year < 2025);
    const hasNewCars = mapped.some(c => c.km === 0);
    const withUsed = hasUsedCars ? mapped : [...mapped, ...DEMO_USED_CARS];
    this._cars.set(hasNewCars ? withUsed : [...DEMO_NEW_CARS, ...withUsed]);
    this.loading.set(false);
  }

  getAll(): Car[] { return this._cars(); }

  getById(id: number): Car | undefined { return this._cars().find(c => c.id === id); }
}
