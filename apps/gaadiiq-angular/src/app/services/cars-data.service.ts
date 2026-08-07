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
  // Present on /cars (the catalogue) and absent from the car nested inside a
  // listing, where the advert's own price is what matters. Serialised as a
  // string because it is a NUMERIC: JSON numbers are floats, and rupee amounts
  // should not pick up rounding on the way here.
  ex_showroom_price?: string | null;
  image_urls?: string[];
}

interface ApiListing {
  id: string; listing_type: 'new' | 'used'; price: number; km_driven: number | null;
  city: string | null; image_urls: string[]; is_featured: boolean;
  condition: string | null; description: string | null;
  ai_valuation: number | null;
  car: ApiCar; seller: { id: string; email: string; full_name: string | null } | null;
}

interface ApiListResponse { items: ApiListing[]; total: number; page: number; page_size: number; }
interface ApiCarListResponse { items: ApiCar[]; total: number; page: number; page_size: number; }

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
 * Below this many distinct make+model combinations, development builds pad the
 * catalogue with demo cars so grids, filters and galleries have something to
 * work against.
 *
 * Counting distinct models rather than listings matters: the catalogue can hold
 * plenty of rows and still be a single car repeated, which leaves every
 * model-grouped view ("N models available") and every brand filter empty.
 */
const DEMO_MIN_MODELS = 4;

/** Key used to tell whether a demo car duplicates a real listing. */
function modelKey(make: string, model: string): string {
  return `${make} ${model}`.toLowerCase().trim();
}

// Demo fallback — shown when the API is unreachable or returns too little
const DEMO_NEW_CARS: Car[] = [
  { id: 'd8001', make: 'Maruti Suzuki', model: 'Swift', variant: 'ZXi+', year: 2025, price: 899000, km: 0, fuel: 'Petrol', transmission: 'AMT', badge: 'Bestseller', badgeType: 'featured', image: img('Maruti Suzuki Swift')[0], images: img('Maruti Suzuki Swift'), rating: 4.4, reviews: 312, verified: true, city: 'Mumbai', bodyType: 'Hatchback', specs: [{ label: 'Mileage', value: '24.8 kmpl' }, { label: 'Power', value: '81 bhp' }], features: ['Sunroof', '6 Airbags', 'Connected Car', 'Wireless Charging'] },
  { id: 'd8002', make: 'Hyundai', model: 'Creta', variant: 'SX Tech', year: 2025, price: 1695000, km: 0, fuel: 'Petrol', transmission: 'Automatic', badge: 'Top Rated', badgeType: 'featured', image: img('Hyundai Creta')[0], images: img('Hyundai Creta'), rating: 4.6, reviews: 210, verified: true, city: 'Delhi', bodyType: 'SUV', specs: [{ label: 'Mileage', value: '17.4 kmpl' }, { label: 'Power', value: '138 bhp' }], features: ['Panoramic Sunroof', 'ADAS Safety', '360° Camera', '6 Airbags'] },
  { id: 'd8003', make: 'Tata', model: 'Nexon EV', variant: 'Max LR', year: 2025, price: 2099000, km: 0, fuel: 'Electric', transmission: 'Automatic', badge: 'Best EV', badgeType: 'featured', image: img('Tata Nexon EV')[0], images: img('Tata Nexon EV'), rating: 4.5, reviews: 175, verified: true, city: 'Bengaluru', bodyType: 'SUV', specs: [{ label: 'Range', value: '465 km' }, { label: 'Power', value: '143 bhp' }], features: ['Panoramic Sunroof', '6 Airbags', 'Connected Car'] },
  { id: 'd8004', make: 'Kia', model: 'Seltos', variant: 'GTX+', year: 2025, price: 1985000, km: 0, fuel: 'Petrol', transmission: 'DCT', badge: 'New', badgeType: 'featured', image: img('Kia Seltos')[0], images: img('Kia Seltos'), rating: 4.5, reviews: 143, verified: true, city: 'Hyderabad', bodyType: 'SUV', specs: [{ label: 'Mileage', value: '17.0 kmpl' }, { label: 'Power', value: '158 bhp' }], features: ['Panoramic Sunroof', 'ADAS Safety', 'Ventilated Seats'] },
  { id: 'd8005', make: 'Mahindra', model: 'XUV700', variant: 'AX7 L', year: 2025, price: 2640000, km: 0, fuel: 'Diesel', transmission: 'Automatic', badge: '7-Seater', badgeType: 'featured', image: img('Mahindra XUV700')[0], images: img('Mahindra XUV700'), rating: 4.6, reviews: 268, verified: true, city: 'Pune', bodyType: 'SUV', specs: [{ label: 'Mileage', value: '16.5 kmpl' }, { label: 'Power', value: '182 bhp' }], features: ['ADAS Safety', 'Panoramic Sunroof', '7 Seats', '6 Airbags'] },
];

const DEMO_USED_CARS: Car[] = [
  { id: 'd9001', make: 'Maruti Suzuki', model: 'Swift', variant: 'VXi', year: 2020, price: 550000, km: 42000, fuel: 'Petrol', transmission: 'Manual', badge: 'Popular', badgeType: 'featured', image: img('Maruti Suzuki Swift')[0], images: img('Maruti Suzuki Swift'), rating: 4.3, reviews: 128, verified: true, city: 'Mumbai', bodyType: 'Hatchback', color: 'White', owners: '1st Owner', specs: [{ label: 'Mileage', value: '21.2 kmpl' }, { label: 'Power', value: '82 bhp' }, { label: 'Engine', value: '1197 cc' }, { label: 'Seating', value: '5' }], features: ['Touchscreen Infotainment', 'Dual Airbags', 'ABS with EBD', 'Alloy Wheels'] },
  { id: 'd9002', make: 'Hyundai', model: 'Creta', variant: 'SX', year: 2021, price: 1150000, km: 28000, fuel: 'Petrol', transmission: 'Automatic', badge: 'Verified', badgeType: 'featured', image: img('Hyundai Creta')[0], images: img('Hyundai Creta'), rating: 4.5, reviews: 95, verified: true, city: 'Bengaluru', bodyType: 'SUV', color: 'Grey', owners: '1st Owner', specs: [{ label: 'Mileage', value: '16.8 kmpl' }, { label: 'Power', value: '113 bhp' }, { label: 'Engine', value: '1497 cc' }, { label: 'Seating', value: '5' }], features: ['Sunroof', '6 Airbags', 'Cruise Control', 'Rear Camera', 'Climate Control'] },
  { id: 'd9003', make: 'Tata', model: 'Nexon', variant: 'XZ+', year: 2022, price: 1080000, km: 18500, fuel: 'Petrol', transmission: 'Manual', badge: 'Low KM', badgeType: 'featured', image: img('Tata Nexon')[0], images: img('Tata Nexon'), rating: 4.4, reviews: 72, verified: true, city: 'Delhi', bodyType: 'SUV', color: 'Blue', owners: '1st Owner', specs: [{ label: 'Mileage', value: '17.4 kmpl' }, { label: 'Power', value: '118 bhp' }, { label: 'Engine', value: '1199 cc' }, { label: 'Seating', value: '5' }], features: ['Sunroof', '5-Star Safety', 'Connected Car', 'Rear Camera'] },
  { id: 'd9004', make: 'Kia', model: 'Seltos', variant: 'HTX', year: 2021, price: 1290000, km: 31000, fuel: 'Petrol', transmission: 'Manual', badge: 'Verified', badgeType: 'featured', image: img('Kia Seltos')[0], images: img('Kia Seltos'), rating: 4.4, reviews: 88, verified: true, city: 'Hyderabad', bodyType: 'SUV', color: 'Red', owners: '1st Owner', specs: [{ label: 'Mileage', value: '16.8 kmpl' }, { label: 'Power', value: '113 bhp' }, { label: 'Engine', value: '1497 cc' }, { label: 'Seating', value: '5' }], features: ['Ventilated Seats', '6 Airbags', 'Wireless Charging', 'Rear Camera'] },
  { id: 'd9005', make: 'Mahindra', model: 'XUV700', variant: 'AX5', year: 2022, price: 1875000, km: 24000, fuel: 'Diesel', transmission: 'Manual', badge: 'Low KM', badgeType: 'featured', image: img('Mahindra XUV700')[0], images: img('Mahindra XUV700'), rating: 4.5, reviews: 61, verified: true, city: 'Pune', bodyType: 'SUV', color: 'Silver', owners: '1st Owner', specs: [{ label: 'Mileage', value: '16.5 kmpl' }, { label: 'Power', value: '152 bhp' }, { label: 'Engine', value: '2184 cc' }, { label: 'Seating', value: '7' }], features: ['7 Seats', '6 Airbags', 'Connected Car', 'Cruise Control', 'Rear Camera'] },
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

/**
 * A catalogue car — a model the manufacturer sells — as a `Car`.
 *
 * Distinct from mapListing: a listing is one seller's advert for one vehicle,
 * whereas this is the model itself. That difference decides the price (the
 * published ex-showroom figure, not an asking price) and `km`, which is 0
 * because a new model has no odometer reading rather than because someone
 * happened to enter zero.
 *
 * Only called for models that carry a price. An unpriced model has no honest
 * rendering on a grid built around price, so those are filtered out upstream
 * rather than shown at ₹0.
 */
function mapCatalogueCar(car: ApiCar): Car {
  const apiImgs = (car.image_urls ?? []).filter(
    u => u && !u.includes('media.gaadiiq.com') && !u.includes('picsum'),
  );
  const images = apiImgs.length ? apiImgs
               : (localImagesFor(car.make, car.model) ?? [PLACEHOLDER]);

  const badge = car.fuel_type === 'electric' ? 'EV'
              : car.fuel_type === 'hybrid' ? 'Eco'
              : car.fuel_type === 'cng' ? 'CNG'
              : '';

  return {
    id: car.id,
    make: car.make,
    model: car.model,
    variant: car.variant ?? undefined,
    year: car.year,
    price: Number(car.ex_showroom_price),
    km: 0,
    fuel: FUEL_LABEL[car.fuel_type ?? ''] ?? car.fuel_type ?? '',
    transmission: TX_LABEL[car.transmission ?? ''] ?? car.transmission ?? '',
    badge,
    badgeType: badge ? 'featured' : '',
    image: images[0],
    images,
    rating: 0,
    reviews: 0,
    verified: true,
    bodyType: BODY_LABEL[car.body_type ?? ''] ?? car.body_type ?? '',
    isSellerListing: false,
    specs: car.engine_cc ? [
      { label: 'Engine', value: `${car.engine_cc} cc` },
      ...(car.seating_capacity ? [{ label: 'Seating', value: `${car.seating_capacity} seats` }] : []),
    ] : [],
    features: [],
  };
}

/**
 * Earliest model year the site treats as a new car.
 *
 * The catalogue pages classify a car as new when it has no odometer reading
 * and a model year at or after this, and as used otherwise. Catalogue models
 * are filtered by the same rule before they are published, because an older
 * model year would otherwise be classified used and appear on the Used Cars
 * pages as a vehicle for sale that no seller is actually offering.
 */
const NEW_CAR_MIN_YEAR = 2024;

/** Identity of a specific model+variant+year, for de-duplication. */
function variantKey(c: { make: string; model: string; variant?: string; year: number }): string {
  return `${c.make}|${c.model}|${c.variant ?? ''}|${c.year}`.toLowerCase().trim();
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
      const [newResp, usedResp, catalogueResp] = await Promise.all([
        firstValueFrom(
          this.http.get<ApiListResponse>(`${this.apiUrl}/listings?listing_type=new&page_size=100`)
        ),
        firstValueFrom(
          this.http.get<ApiListResponse>(`${this.apiUrl}/listings?listing_type=used&page_size=100`)
        ),
        // The catalogue of manufacturer models, which is where admin-uploaded
        // photography lands. Without this the New Cars pages could only show
        // models some seller had happened to advertise, so an uploaded image
        // had no route to a buyer. priced_only keeps models nobody has priced
        // out of a grid that sorts and filters on price.
        firstValueFrom(
          this.http.get<ApiCarListResponse>(
            `${this.apiUrl}/cars?bucket=new&priced_only=true&page_size=100`
          )
        ),
      ]);

      const newCars = (newResp?.items ?? []).map(mapListing);
      const usedCars = (usedResp?.items ?? []).map(mapListing);

      // A model that a seller has already advertised wins: that row carries a
      // real advert a buyer can act on, and showing both would put the same
      // car on the page twice at two different prices.
      const advertised = new Set(newCars.map(variantKey));
      const catalogueCars = (catalogueResp?.items ?? [])
        .filter(c => c.ex_showroom_price != null && c.year >= NEW_CAR_MIN_YEAR)
        .map(mapCatalogueCar)
        .filter(c => !advertised.has(variantKey(c)));

      const all = [...newCars, ...usedCars, ...catalogueCars];

      // Demo cars fill out a thin catalogue during development so the UI can
      // be exercised against a realistic number of results. They are never
      // shown in production, where a real listing count is the honest signal
      // and fabricated cars alongside real ones would mislead buyers.
      const realModels = new Set(all.map(c => modelKey(c.make, c.model)));
      const needsFiller = !environment.production && realModels.size < DEMO_MIN_MODELS;

      if (!needsFiller) {
        // Either the catalogue is varied enough, or this is production, where a
        // thin real catalogue is the honest signal and fabricated cars beside
        // real ones would mislead buyers.
        this._cars.set(all.length ? all : []);
      } else {
        // Keep every real listing, and add only demo models the catalogue does
        // not already carry, so a real car is never shadowed by a fake one.
        const filler = [...DEMO_NEW_CARS, ...DEMO_USED_CARS]
          .filter(c => !realModels.has(modelKey(c.make, c.model)));
        this._cars.set([...all, ...filler]);
      }
    } catch (err) {
      console.error('API fetch error — falling back to demo data:', err);
      // Same rule as above: demo cars are a development aid, never something a
      // real buyer sees. In production an outage shows an empty catalogue.
      this._cars.set(environment.production ? [] : [...DEMO_NEW_CARS, ...DEMO_USED_CARS]);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Re-fetch the catalogue.
   *
   * Called after an admin changes something every page reads — a price, say —
   * so the rest of the app reflects it without a full reload. The admin
   * pricing screen previously reached for a private `load` through an `any`
   * cast, which silently did nothing.
   */
  reload(): Promise<void> { return this.load(); }

  getAll(): Car[] { return this._cars(); }

  getById(id: string): Car | undefined { return this._cars().find(c => c.id === id); }

  addApprovedVehicle(car: Car): void {
    // Avoid duplicates by id
    if (this._cars().some(c => c.id === car.id)) return;
    this._cars.update(list => [car, ...list]);
  }
}
