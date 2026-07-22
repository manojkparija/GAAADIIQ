import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Car {
  id: string; make: string; model: string; variant?: string; year: number; price: number;
  km: number; fuel: string; transmission: string; badge: string; badgeType: string;
  image: string; images?: string[]; rating: number; reviews: number; verified: boolean;
  city?: string; bodyType?: string; color?: string; owners?: string;
  isSellerListing?: boolean;
  sellerEmail?: string;
  specs?: { label: string; value: string }[];
  features?: string[];
  aiValuation?: { fairPrice: number; marketMin: number; marketMax: number; verdict: string; confidence: number };
}

// ── API response shapes ────────────────────────────────────────────────────────
interface ApiCar {
  id: string; make: string; model: string; variant: string | null; year: number;
  fuel_type: string | null; transmission: string | null; body_type: string | null;
  seating_capacity: number | null; engine_cc: number | null;
}

interface ApiListing {
  id: string; listing_type: 'new' | 'used'; price: number; km_driven: number | null;
  city: string | null; image_urls: string[]; is_featured: boolean;
  condition: string | null; description: string | null;
  ai_valuation: number | null;
  car: ApiCar; seller: { id: string; email: string; full_name: string | null } | null;
}

interface ApiListResponse { items: ApiListing[]; total: number; page: number; page_size: number; }

// ── Local assets ───────────────────────────────────────────────────────────────
const PLACEHOLDER = 'assets/cars/placeholder.svg';

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

const MODEL_IMAGE_FALLBACK: Record<string, string> = {
  'Maruti Suzuki Swift': 'assets/cars/swift/front.jpg',
  'Swift': 'assets/cars/swift/front.jpg',
};

// Fuel-type label normalisation (API uses lowercase enum values)
const FUEL_LABEL: Record<string, string> = {
  petrol: 'Petrol', diesel: 'Diesel', electric: 'Electric',
  cng: 'CNG', hybrid: 'Hybrid',
};

const TX_LABEL: Record<string, string> = {
  manual: 'Manual', automatic: 'Automatic', amt: 'AMT',
  cvt: 'CVT', dct: 'DCT',
};

const BODY_LABEL: Record<string, string> = {
  hatchback: 'Hatchback', sedan: 'Sedan', suv: 'SUV',
  muv: 'MUV', coupe: 'Coupe', convertible: 'Convertible',
};

// Demo fallback — shown only when the API is unreachable
const DEMO_NEW_CARS: Car[] = [
  { id: 'd8001', make: 'Maruti Suzuki', model: 'Swift', variant: 'ZXi+', year: 2025, price: 899000, km: 0, fuel: 'Petrol', transmission: 'AMT', badge: 'Bestseller', badgeType: 'featured', image: 'assets/cars/swift/front.jpg', images: ['assets/cars/swift/front.jpg'], rating: 4.4, reviews: 312, verified: true, city: 'Mumbai', bodyType: 'Hatchback', specs: [{ label: 'Mileage', value: '24.8 kmpl' }, { label: 'Power', value: '81 bhp' }], features: ['Sunroof', '6 Airbags', 'Connected Car', 'Wireless Charging'] },
  { id: 'd8002', make: 'Hyundai', model: 'Creta', variant: 'SX Tech', year: 2025, price: 1695000, km: 0, fuel: 'Petrol', transmission: 'Automatic', badge: 'Top Rated', badgeType: 'featured', image: PLACEHOLDER, images: [], rating: 4.6, reviews: 210, verified: true, city: 'Delhi', bodyType: 'SUV', specs: [{ label: 'Mileage', value: '17.4 kmpl' }, { label: 'Power', value: '138 bhp' }], features: ['Panoramic Sunroof', 'ADAS Safety', '360° Camera', '6 Airbags'] },
  { id: 'd8003', make: 'Tata', model: 'Nexon EV', variant: 'Max LR', year: 2025, price: 2099000, km: 0, fuel: 'Electric', transmission: 'Automatic', badge: 'Best EV', badgeType: 'featured', image: PLACEHOLDER, images: [], rating: 4.5, reviews: 175, verified: true, city: 'Bengaluru', bodyType: 'SUV', specs: [{ label: 'Range', value: '465 km' }, { label: 'Power', value: '143 bhp' }], features: ['Panoramic Sunroof', '6 Airbags', 'Connected Car'] },
];

const DEMO_USED_CARS: Car[] = [
  { id: 'd9001', make: 'Maruti Suzuki', model: 'Swift', variant: 'VXi', year: 2020, price: 550000, km: 42000, fuel: 'Petrol', transmission: 'Manual', badge: 'Popular', badgeType: 'featured', image: 'assets/cars/swift/front.jpg', images: ['assets/cars/swift/front.jpg'], rating: 4.3, reviews: 128, verified: true, city: 'Mumbai', bodyType: 'Hatchback', color: 'White', owners: '1st Owner' },
  { id: 'd9002', make: 'Hyundai', model: 'Creta', variant: 'SX', year: 2021, price: 1150000, km: 28000, fuel: 'Petrol', transmission: 'Automatic', badge: 'Verified', badgeType: 'featured', image: PLACEHOLDER, images: [], rating: 4.5, reviews: 95, verified: true, city: 'Bengaluru', bodyType: 'SUV', color: 'Grey', owners: '1st Owner' },
  { id: 'd9003', make: 'Tata', model: 'Nexon', variant: 'XZ+', year: 2022, price: 1080000, km: 18500, fuel: 'Petrol', transmission: 'Manual', badge: 'Low KM', badgeType: 'featured', image: PLACEHOLDER, images: [], rating: 4.4, reviews: 72, verified: true, city: 'Delhi', bodyType: 'SUV', color: 'Blue', owners: '1st Owner' },
];

// ── Mapping helper ─────────────────────────────────────────────────────────────
function mapListing(lst: ApiListing): Car {
  const car = lst.car;
  const makeModel = `${car.make} ${car.model}`;
  const localImgs = LOCAL_IMAGES[makeModel];
  const apiImgs = (lst.image_urls ?? []).filter(u => u && !u.includes('aeplcdn'));

  const images = localImgs?.length ? localImgs
               : apiImgs.length ? apiImgs
               : [PLACEHOLDER];
  const image = images[0];

  const badge = lst.is_featured ? 'Featured'
              : car.fuel_type === 'electric' ? 'EV'
              : car.fuel_type === 'hybrid' ? 'Eco'
              : car.fuel_type === 'cng' ? 'CNG'
              : '';

  const owners = lst.km_driven === 0 ? undefined
               : lst.condition === 'excellent' ? '1st Owner' : undefined;

  return {
    id: lst.id,
    make: car.make,
    model: car.model,
    variant: car.variant ?? undefined,
    year: car.year,
    price: Number(lst.price),
    km: lst.km_driven ?? 0,
    fuel: FUEL_LABEL[car.fuel_type ?? ''] ?? car.fuel_type ?? '',
    transmission: TX_LABEL[car.transmission ?? ''] ?? car.transmission ?? '',
    badge,
    badgeType: badge ? 'featured' : '',
    image,
    images,
    rating: 0,
    reviews: 0,
    verified: true,
    city: lst.city ?? undefined,
    bodyType: BODY_LABEL[car.body_type ?? ''] ?? car.body_type ?? '',
    color: undefined,
    owners,
    isSellerListing: lst.listing_type === 'used',
    sellerEmail: lst.seller?.email,
    specs: car.engine_cc ? [
      { label: 'Engine', value: `${car.engine_cc} cc` },
      ...(car.seating_capacity ? [{ label: 'Seating', value: `${car.seating_capacity} seats` }] : []),
    ] : [],
    features: [],
    aiValuation: lst.ai_valuation ? {
      fairPrice: lst.ai_valuation, marketMin: lst.ai_valuation * 0.95,
      marketMax: lst.ai_valuation * 1.05, verdict: 'Fair', confidence: 0.8,
    } : undefined,
  };
}

// ── Service ────────────────────────────────────────────────────────────────────
@Injectable({ providedIn: 'root' })
export class CarsDataService {
  private _cars = signal<Car[]>([]);
  readonly cars = this._cars.asReadonly();
  readonly loading = signal(true);

  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {
    this.load();
  }

  private async load() {
    this.loading.set(true);
    try {
      const [newResp, usedResp] = await Promise.all([
        firstValueFrom(
          this.http.get<ApiListResponse>(`${this.apiUrl}/listings?listing_type=new&page_size=100`)
        ),
        firstValueFrom(
          this.http.get<ApiListResponse>(`${this.apiUrl}/listings?listing_type=used&page_size=100`)
        ),
      ]);

      const newCars = (newResp?.items ?? []).map(mapListing);
      const usedCars = (usedResp?.items ?? []).map(mapListing);

      const all = [...newCars, ...usedCars];
      this._cars.set(
        all.length ? all : [...DEMO_NEW_CARS, ...DEMO_USED_CARS]
      );
    } catch (err) {
      console.error('API fetch error — falling back to demo data:', err);
      this._cars.set([...DEMO_NEW_CARS, ...DEMO_USED_CARS]);
    } finally {
      this.loading.set(false);
    }
  }

  getAll(): Car[] { return this._cars(); }

  getById(id: string): Car | undefined { return this._cars().find(c => c.id === id); }
}
