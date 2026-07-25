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

/**
 * Local images keyed by "Make Model" (lower-case).
 *
 * Used for both API listings and the demo fallback, so cars render the same
 * way whether or not the backend is reachable. Drop real photographs in at
 * these paths (any extension — update the entry) and nothing else changes.
 *
 * These are placeholder illustrations, not vehicle photographs.
 */
const LOCAL_IMAGES: Record<string, string[]> = {
  'maruti suzuki swift': ['assets/cars/maruti-swift/front.svg', 'assets/cars/maruti-swift/side.svg'],
  'maruti suzuki dzire': ['assets/cars/maruti-dzire/front.svg', 'assets/cars/maruti-dzire/side.svg'],
  'hyundai creta':       ['assets/cars/hyundai-creta/front.svg', 'assets/cars/hyundai-creta/side.svg'],
  'tata nexon':          ['assets/cars/tata-nexon/front.svg', 'assets/cars/tata-nexon/side.svg'],
  'kia seltos':          ['assets/cars/kia-seltos/front.svg', 'assets/cars/kia-seltos/side.svg'],
  'mahindra xuv700':     ['assets/cars/mahindra-xuv700/front.svg', 'assets/cars/mahindra-xuv700/side.svg'],
};

/** Local images for a make/model, or null when we have none. */
function localImagesFor(make: string, model: string): string[] | null {
  const exact = LOCAL_IMAGES[`${make} ${model}`.toLowerCase().trim()];
  if (exact) return exact;
  // "Nexon EV" should fall back to the Nexon images rather than a placeholder.
  const base = LOCAL_IMAGES[`${make} ${model.split(' ')[0]}`.toLowerCase().trim()];
  return base ?? null;
}

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

// Model-level specs/features enrichment (sourced from official brochures)
const MODEL_SPECS: Record<string, (variant: string, fuel: string) => { specs: {label:string;value:string}[]; features: string[] }> = {
  'Maruti Suzuki Dzire': (variant, fuel) => {
    const isAMT = variant.includes('AMT');
    const isCNG = fuel === 'CNG';
    const isZXiPlus = variant.includes('ZXi+');
    const isZXi = variant.includes('ZXi');
    const mileage = isCNG ? '33.73 km/kg' : isAMT ? '25.71 km/l' : '24.79 km/l';
    const specs = [
      { label: 'Engine', value: '1.2L Z-Series' },
      { label: 'Power', value: '81.58 PS' },
      { label: 'Torque', value: '111.7 Nm' },
      { label: 'Mileage', value: mileage },
      { label: 'Transmission', value: isAMT ? 'AGS (AMT)' : '5-Speed MT' },
      { label: 'Boot Space', value: '382 L' },
      { label: 'Fuel', value: isCNG ? 'Petrol + CNG' : 'Petrol' },
    ];
    const features = ['6 Airbags', 'Suzuki Connect', 'ESP + Hill Hold'];
    if (isZXi || isZXiPlus) features.push('SmartPlay Pro+', 'Wireless Charger', 'LED Headlamps', 'Cruise Control');
    if (isZXiPlus) features.push('Electric Sunroof', '360° Camera', 'Auto Climate Control', 'Rear AC Vent');
    return { specs, features };
  },
};

/** Local images for a demo car; falls back to the generic placeholder. */
function img(makeModel: string): string[] {
  const [make, ...rest] = makeModel.split(' ');
  return LOCAL_IMAGES[makeModel.toLowerCase()]
      ?? localImagesFor(make, rest.join(' '))
      ?? [PLACEHOLDER];
}

/**
 * Below this many real listings, development builds pad the catalogue with
 * demo cars so grids, filters and galleries have something to work against.
 */
const DEMO_MIN_RESULTS = 6;

// Demo fallback — shown when the API is unreachable or returns too little
const DEMO_NEW_CARS: Car[] = [
  { id: 'd8001', make: 'Maruti Suzuki', model: 'Swift', variant: 'ZXi+', year: 2025, price: 899000, km: 0, fuel: 'Petrol', transmission: 'AMT', badge: 'Bestseller', badgeType: 'featured', image: img('Maruti Suzuki Swift')[0], images: img('Maruti Suzuki Swift'), rating: 4.4, reviews: 312, verified: true, city: 'Mumbai', bodyType: 'Hatchback', specs: [{ label: 'Mileage', value: '24.8 kmpl' }, { label: 'Power', value: '81 bhp' }], features: ['Sunroof', '6 Airbags', 'Connected Car', 'Wireless Charging'] },
  { id: 'd8002', make: 'Hyundai', model: 'Creta', variant: 'SX Tech', year: 2025, price: 1695000, km: 0, fuel: 'Petrol', transmission: 'Automatic', badge: 'Top Rated', badgeType: 'featured', image: img('Hyundai Creta')[0], images: img('Hyundai Creta'), rating: 4.6, reviews: 210, verified: true, city: 'Delhi', bodyType: 'SUV', specs: [{ label: 'Mileage', value: '17.4 kmpl' }, { label: 'Power', value: '138 bhp' }], features: ['Panoramic Sunroof', 'ADAS Safety', '360° Camera', '6 Airbags'] },
  { id: 'd8003', make: 'Tata', model: 'Nexon EV', variant: 'Max LR', year: 2025, price: 2099000, km: 0, fuel: 'Electric', transmission: 'Automatic', badge: 'Best EV', badgeType: 'featured', image: img('Tata Nexon EV')[0], images: img('Tata Nexon EV'), rating: 4.5, reviews: 175, verified: true, city: 'Bengaluru', bodyType: 'SUV', specs: [{ label: 'Range', value: '465 km' }, { label: 'Power', value: '143 bhp' }], features: ['Panoramic Sunroof', '6 Airbags', 'Connected Car'] },
  { id: 'd8004', make: 'Kia', model: 'Seltos', variant: 'GTX+', year: 2025, price: 1985000, km: 0, fuel: 'Petrol', transmission: 'DCT', badge: 'New', badgeType: 'featured', image: img('Kia Seltos')[0], images: img('Kia Seltos'), rating: 4.5, reviews: 143, verified: true, city: 'Hyderabad', bodyType: 'SUV', specs: [{ label: 'Mileage', value: '17.0 kmpl' }, { label: 'Power', value: '158 bhp' }], features: ['Panoramic Sunroof', 'ADAS Safety', 'Ventilated Seats'] },
  { id: 'd8005', make: 'Mahindra', model: 'XUV700', variant: 'AX7 L', year: 2025, price: 2640000, km: 0, fuel: 'Diesel', transmission: 'Automatic', badge: '7-Seater', badgeType: 'featured', image: img('Mahindra XUV700')[0], images: img('Mahindra XUV700'), rating: 4.6, reviews: 268, verified: true, city: 'Pune', bodyType: 'SUV', specs: [{ label: 'Mileage', value: '16.5 kmpl' }, { label: 'Power', value: '182 bhp' }], features: ['ADAS Safety', 'Panoramic Sunroof', '7 Seats', '6 Airbags'] },
];

const DEMO_USED_CARS: Car[] = [
  { id: 'd9001', make: 'Maruti Suzuki', model: 'Swift', variant: 'VXi', year: 2020, price: 550000, km: 42000, fuel: 'Petrol', transmission: 'Manual', badge: 'Popular', badgeType: 'featured', image: img('Maruti Suzuki Swift')[0], images: img('Maruti Suzuki Swift'), rating: 4.3, reviews: 128, verified: true, city: 'Mumbai', bodyType: 'Hatchback', color: 'White', owners: '1st Owner' },
  { id: 'd9002', make: 'Hyundai', model: 'Creta', variant: 'SX', year: 2021, price: 1150000, km: 28000, fuel: 'Petrol', transmission: 'Automatic', badge: 'Verified', badgeType: 'featured', image: img('Hyundai Creta')[0], images: img('Hyundai Creta'), rating: 4.5, reviews: 95, verified: true, city: 'Bengaluru', bodyType: 'SUV', color: 'Grey', owners: '1st Owner' },
  { id: 'd9003', make: 'Tata', model: 'Nexon', variant: 'XZ+', year: 2022, price: 1080000, km: 18500, fuel: 'Petrol', transmission: 'Manual', badge: 'Low KM', badgeType: 'featured', image: img('Tata Nexon')[0], images: img('Tata Nexon'), rating: 4.4, reviews: 72, verified: true, city: 'Delhi', bodyType: 'SUV', color: 'Blue', owners: '1st Owner' },
  { id: 'd9004', make: 'Kia', model: 'Seltos', variant: 'HTX', year: 2021, price: 1290000, km: 31000, fuel: 'Petrol', transmission: 'Manual', badge: 'Verified', badgeType: 'featured', image: img('Kia Seltos')[0], images: img('Kia Seltos'), rating: 4.4, reviews: 88, verified: true, city: 'Hyderabad', bodyType: 'SUV', color: 'Red', owners: '1st Owner' },
  { id: 'd9005', make: 'Mahindra', model: 'XUV700', variant: 'AX5', year: 2022, price: 1875000, km: 24000, fuel: 'Diesel', transmission: 'Manual', badge: 'Low KM', badgeType: 'featured', image: img('Mahindra XUV700')[0], images: img('Mahindra XUV700'), rating: 4.5, reviews: 61, verified: true, city: 'Pune', bodyType: 'SUV', color: 'Silver', owners: '1st Owner' },
];

// ── Mapping helper ─────────────────────────────────────────────────────────────
function mapListing(lst: ApiListing): Car {
  const car = lst.car;
  const makeModel = `${car.make} ${car.model}`;
  // Known-dead hosts are stripped: media.gaadiiq.com is not serving, and
  // picsum URLs are seed placeholders rather than real vehicle photos.
  const apiImgs = (lst.image_urls ?? []).filter(u => u && !u.includes('media.gaadiiq.com') && !u.includes('picsum'));

  // Prefer real API images; otherwise use a local illustration for this
  // model, and only fall back to the generic placeholder when we have neither.
  const images = apiImgs.length ? apiImgs
               : (localImagesFor(car.make, car.model) ?? [PLACEHOLDER]);
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
    ...(() => {
      const enrichFn = MODEL_SPECS[makeModel];
      if (enrichFn) return enrichFn(car.variant ?? '', FUEL_LABEL[car.fuel_type ?? ''] ?? '');
      return {
        specs: car.engine_cc ? [
          { label: 'Engine', value: `${car.engine_cc} cc` },
          ...(car.seating_capacity ? [{ label: 'Seating', value: `${car.seating_capacity} seats` }] : []),
        ] : [],
        features: [] as string[],
      };
    })(),
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

      // Demo cars fill out a thin catalogue during development so the UI can
      // be exercised against a realistic number of results. They are never
      // shown in production, where a real listing count is the honest signal
      // and fabricated cars alongside real ones would mislead buyers.
      const needsFiller = !environment.production && all.length < DEMO_MIN_RESULTS;
      this._cars.set(
        all.length && !needsFiller ? all
        : needsFiller ? [...all, ...DEMO_NEW_CARS, ...DEMO_USED_CARS]
        : [...DEMO_NEW_CARS, ...DEMO_USED_CARS]
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

  addApprovedVehicle(car: Car): void {
    // Avoid duplicates by id
    if (this._cars().some(c => c.id === car.id)) return;
    this._cars.update(list => [car, ...list]);
  }
}
