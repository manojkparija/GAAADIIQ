import { Injectable, computed, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Car {
  id: string; make: string; model: string; variant?: string; year: number; price: number;
  km: number; fuel: string; transmission: string; badge: string; badgeType: string;
  image: string; images?: string[]; rating: number; reviews: number; verified: boolean;
  /**
   * Ordered 360° frames, when the model has been shot on a turntable. Kept
   * apart from `images` because one frame on its own is meaningless — the
   * sequence is the asset. Empty or absent on almost every car.
   */
  spinImages?: string[];
  city?: string; bodyType?: string; color?: string; owners?: string;
  /** Seller-stated condition, as the listing records it ('excellent' | 'good' | …). */
  condition?: string;
  isSellerListing?: boolean;
  /**
   * True for a row of the manufacturer catalogue, false for someone's advert.
   *
   * isSellerListing does not answer this: it is `listing_type === 'used'`, so
   * a dealer's advert for a brand-new car reads false there too. The
   * photograph rule applies to catalogue rows only — an advert is a real car
   * someone is trying to sell, and hiding it removes them from the
   * marketplace — so the distinction needs a field of its own.
   */
  fromCatalogue?: boolean;
  /** Published trims for this model, 0 when none have been entered. */
  variantCount?: number;
  /**
   * The price band the published trims span, in rupees, when any of them
   * carries a price. A listing card cannot derive this — it holds one
   * catalogue row and never fetches that row's trims — so it used `price`,
   * which is maintained separately and drifts away from the trims.
   */
  variantPriceMin?: number;
  variantPriceMax?: number;
  /**
   * Every gearbox and fuel the published trims are sold with.
   *
   * A catalogue row carries one `transmission` and one `fuel`, but a model is
   * sold with several: the S-Presso row says Manual while three published
   * trims are Automatic. Filtering on the row's single value hid the model
   * from anyone ticking Automatic, and a model filtered out of a grid looks
   * exactly like a model that does not exist.
   */
  variantTransmissions?: string[];
  variantFuels?: string[];
  sellerEmail?: string;
  specs?: { label: string; value: string }[];
  features?: string[];
  aiValuation?: { fairPrice: number; marketMin: number; marketMax: number; verdict: string; confidence: number };
}

/**
 * A NUMERIC the API serialised as a string, as a number — or undefined.
 *
 * Undefined rather than 0 on purpose: callers treat this band as "present or
 * not", and a 0 would read as a car that costs nothing rather than a car whose
 * trims carry no price.
 */
function rupeesOrUndefined(value: string | number | null | undefined): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
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
  /** Ordered 360° frames. Only the single-car endpoint returns these. */
  spin_urls?: string[];
  /** Published trims, counted by the API. */
  variant_count?: number;
  /**
   * The band those published trims span. NUMERIC, so serialised as a string
   * for the same reason ex_showroom_price is. Null when no trim is priced.
   */
  variant_price_min?: string | null;
  /** Gearboxes and fuels across the published trims, each named once. */
  variant_transmissions?: string[];
  variant_fuels?: string[];
  variant_price_max?: string | null;
  specs?: { label: string; value: string }[] | null;
  features?: string[] | null;
}

interface ApiListing {
  id: string; listing_type: 'new' | 'used'; price: number; km_driven: number | null;
  city: string | null; image_urls: string[]; is_featured: boolean;
  condition: string | null; description: string | null;
  /** The API has sent this all along; the mapper below was guessing instead. */
  owners_count: number | null;
  ai_valuation: number | null;
  car: ApiCar; seller: { id: string; email: string; full_name: string | null } | null;
}

/** One trim of a model, priced as the manufacturer publishes it. */
export interface CarVariant {
  id: string;
  car_id: string;
  name: string;
  /**
   * NUMERIC in the column, but a JSON *number* on the wire: the API types this
   * Decimal and Pydantic serialises Decimal as a number.
   *
   * Declared `string` alone for a long time, which was simply untrue, and the
   * variants editor crashed on `.trim()` the moment anyone edited a priced
   * trim. Coerce with String() before doing anything string-shaped to it.
   */
  ex_showroom_price: string | number | null;
  fuel_type: string | null;
  transmission: string | null;
  engine_cc: number | null;
  seating_capacity: number | null;
  mileage: string | null;
  features: string[] | null;
  status: 'draft' | 'published';
  source: 'manual' | 'ai';
  sort_order: number;
}

interface ApiListResponse { items: ApiListing[]; total: number; page: number; page_size: number; }
interface ApiCarListResponse { items: ApiCar[]; total: number; page: number; page_size: number; }

// ── Local assets ───────────────────────────────────────────────────────────────
/**
 * Stands in for a car with no photograph.
 *
 * Exported because callers have to be able to tell it apart from a real
 * image. mapCatalogueCar substitutes it rather than leaving `image` empty, so
 * "does this car have a picture?" cannot be answered by a truthiness check —
 * every car passes one. The New Cars grid asked that question and picked a
 * placeholder over a car with seven photographs; it had its own copy of this
 * literal at the time, which is why the two could not be compared.
 */
export const PLACEHOLDER = 'assets/cars/placeholder.svg';

/**
 * Whether a car has a photograph the site can actually render.
 *
 * Exported because four screens now ask it — the New Cars grid, the Browse
 * model grid, the Browse card grid and the compare picker — and a copy per
 * screen is how they came to disagree in the first place: one hid a model with
 * no picture while its neighbour drew it as a blank card.
 *
 * Two exclusions, both deliberate:
 *
 * - the placeholder, because mapCatalogueCar substitutes it rather than
 *   leaving `image` empty, so a truthiness check passes for every car;
 * - aeplcdn, a third party's URLs that are frequently dead. A broken image
 *   tag is worse than an honest absence.
 */
/**
 * One readable line describing why a request failed.
 *
 * status 0 is the interesting one and the least self-explanatory: Angular
 * reports it whenever no response arrived at all, which covers a network
 * failure, a CORS rejection and a request that never left the browser. Those
 * are indistinguishable from JavaScript by design — the browser withholds the
 * detail — so the text says so rather than guessing, because guessing at this
 * exact point is what cost a day.
 */
export function describeFailure(url: string, err: unknown): string {
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('&_=')[0];

  if (err instanceof HttpErrorResponse) {
    if (err.status === 0) {
      return `${path} — no response (network, CORS, or blocked before sending)`;
    }
    const detail =
      typeof err.error === 'string'
        ? err.error.slice(0, 120)
        : (err.error?.detail ?? err.statusText ?? '');
    return `${path} — HTTP ${err.status}${detail ? ` ${detail}` : ''}`;
  }
  return `${path} — ${(err as Error)?.message ?? String(err)}`;
}

/** Attempts per catalogue source when nothing answers at all. */
const FETCH_ATTEMPTS = 3;

/** Gap between those attempts. */
const FETCH_RETRY_MS = 250;

export function hasPhotograph(car: { image?: string | null }): boolean {
  return !!car.image
    && car.image !== PLACEHOLDER
    && !String(car.image).includes('aeplcdn');
}

/**
 * Whether a car belongs on a buyer-facing list at all.
 *
 * An advert is exempt from the photograph rule: it is a real car someone is
 * trying to sell, and hiding it removes them from the marketplace. A catalogue
 * row with no picture is only an absence of data.
 *
 * A row from an older API build carries no `fromCatalogue` and is treated as
 * catalogue — the safe direction, since an advert wrongly hidden costs a
 * seller more than a blank catalogue card costs a browser.
 */
export function isShowable(car: { image?: string | null; fromCatalogue?: boolean }): boolean {
  return car.fromCatalogue === false || hasPhotograph(car);
}

/**
 * What a model costs *from*: the cheapest published trim.
 *
 * `car.price` is one hand-maintained figure on the catalogue row, and it is
 * not the entry price — the Fronx row reads ₹9.3L against trims running
 * ₹6.84L to ₹11.98L. Any surface that says "onwards", "starts at" or "from"
 * and reads `car.price` is therefore promising that nothing is cheaper while
 * ₹2.46L of the range sits below it.
 *
 * This has now been found and fixed three times on three different screens —
 * the listings grid, the New Cars grid, and the similar-cars table on the car
 * detail page — because each one did the arithmetic itself. It lives here so
 * the fourth surface inherits it instead of repeating it.
 *
 * Falls back to the row's figure for a model whose trims are unpriced or not
 * entered yet: that is the only price such a car has.
 */
export function startingPrice(car: { price: number; variantPriceMin?: number }): number {
  return car.variantPriceMin ?? car.price;
}

/**
 * The band a model is sold across, as [cheapest, dearest] published trims.
 *
 * Null when the trims carry no prices, so a caller can tell "one price" from
 * "a range that happens to be a point" and render "onwards" only when it is
 * true.
 */
export function priceBand(
  car: { price: number; variantPriceMin?: number; variantPriceMax?: number },
): [number, number] | null {
  const { variantPriceMin: lo, variantPriceMax: hi } = car;
  return lo != null && hi != null ? [lo, hi] : null;
}

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

  // The database is the only source of a car's photographs.
  //
  // This used to substitute a bundled illustration for six models, so
  // deleting every image for a Swift still left a picture on its card. An
  // image is uploaded through the app and removed through it; the screen has
  // to agree with the database, and a drawing that appears when there is
  // nothing to show hides the fact that there is nothing to show.
  const images = apiImgs.length ? apiImgs : [PLACEHOLDER];
  const image = images[0];

  const badge = lst.is_featured ? 'Featured'
              : car.fuel_type === 'electric' ? 'EV'
              : car.fuel_type === 'hybrid' ? 'Eco'
              : car.fuel_type === 'cng' ? 'CNG'
              : '';

  // Read from owners_count, which the listing actually carries.
  //
  // It used to be inferred from the condition — `condition === 'excellent'`
  // meant "1st Owner" — and condition says nothing whatever about how many
  // people have owned the car. A well-kept third-owner car was reported as
  // single-owner, on the page and to the condition score, and a genuine
  // single-owner car in merely good condition showed nothing at all.
  const owners = lst.km_driven === 0 || !lst.owners_count
    ? undefined
    : lst.owners_count === 1 ? '1st Owner'
    : lst.owners_count === 2 ? '2nd Owner'
    : lst.owners_count === 3 ? '3rd Owner'
    : `${lst.owners_count}th Owner`;

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
    condition: lst.condition ?? undefined,
    isSellerListing: lst.listing_type === 'used',
    fromCatalogue: false,
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
  // As in mapListing: the database is the only source. See the note there.
  const images = apiImgs.length ? apiImgs : [PLACEHOLDER];

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
    fromCatalogue: true,
    variantCount: car.variant_count ?? 0,
    variantPriceMin: rupeesOrUndefined(car.variant_price_min),
    variantPriceMax: rupeesOrUndefined(car.variant_price_max),
    variantTransmissions: car.variant_transmissions ?? [],
    variantFuels: car.variant_fuels ?? [],
    // A curated specification wins; the engine/seating pair is the fallback
    // for a model nobody has researched yet.
    specs: car.specs?.length ? car.specs : (car.engine_cc ? [
      { label: 'Engine', value: `${car.engine_cc} cc` },
      ...(car.seating_capacity ? [{ label: 'Seating', value: `${car.seating_capacity} seats` }] : []),
    ] : []),
    features: car.features ?? [],
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

  /**
   * Which catalogue sources failed on the last load.
   *
   * Without this, an outage and an empty catalogue are the same screen. Both
   * render "0 cars found", and a buyer — or whoever is checking whether the
   * site works — has no way to tell "nobody has listed a used car" from "the
   * listings endpoint is down". That has already cost time on this project once,
   * on the dealer dashboard.
   *
   * Empty rather than a boolean, so a page can say which half is missing: the
   * used grid should not claim an outage because the *new* catalogue failed.
   */
  readonly failedSources = signal<readonly ('new' | 'used' | 'catalogue')[]>([]);

  /**
   * Why the last failure happened, in one line, for a person to read.
   *
   * WHY THIS IS ON SCREEN AND NOT ONLY IN THE CONSOLE
   *
   * This fault is intermittent — the same build served the catalogue on one
   * load and nothing on the next. Catching it in the console therefore means
   * having DevTools already open at the moment it happens, which is not
   * something to ask of somebody reporting a bug from a phone.
   *
   * The failure panel is already on their screen when it goes wrong, so the
   * screenshot they would send anyway can carry the answer. That turns every
   * future report into a diagnosis instead of a guess — six attempts at this
   * symptom were built on inference about which layer was at fault, and every
   * one of them was wrong because nobody had the actual error.
   *
   * Deliberately terse and factual: a status code, the path, and the message
   * the browser gave. Enough to name the layer, and nothing a reader could
   * mistake for something they did.
   */
  readonly lastFailure = signal<string>('');

  readonly usedListingsFailed = computed(() => this.failedSources().includes('used'));
  readonly newListingsFailed = computed(
    () => this.failedSources().includes('new') || this.failedSources().includes('catalogue'),
  );

  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {
    this.load();
  }

  /**
   * Fetch one catalogue source, returning null rather than throwing when it
   * fails.
   *
   * null is deliberately distinct from an empty response: it means "this
   * source did not answer", which lets the caller tell a genuinely empty
   * catalogue apart from an outage.
   */
  private async fetchOrNull<T>(url: string): Promise<T | null> {
    // Retried only when nothing answered at all.
    //
    // A response — even a 500 — is a real answer from a reachable API, and
    // asking again three times just makes a broken endpoint slower to report.
    // What is worth retrying is the case where the request produced no response
    // whatsoever: status 0, which Angular reports for a network failure, a
    // CORS rejection, or a request that never left the browser.
    //
    // That last one is what this is for. This load runs from the constructor,
    // the earliest and raciest moment in the app's life, and a single attempt
    // there turned one unlucky millisecond into a page reading "0 models
    // available" until the reader hard-refreshed.
    //
    // Two extra attempts, a quarter-second apart. Short enough that a genuine
    // outage still fails fast and the page says so rather than hanging.
    // A key no cache can already hold.
    //
    // WHY THIS IS HERE, AND WHY IT IS BLUNT
    //
    // Reported all day, and still after four other fixes: "0 models available"
    // on a normal reload, the full catalogue after a hard refresh, every time.
    // A hard refresh differs from a normal one in exactly one way — it sends
    // `Cache-Control: no-cache`, so it skips every cache between the page and
    // the origin. Nothing else about the two loads differs.
    //
    // Each individual cache was examined and cleared of blame: the API stamps
    // no-store on any request carrying Authorization (and the reporter is
    // signed in), the service worker's patterns never match `/cars?...`, and
    // Vary: Origin is set on everything cacheable. Every one of those was
    // reasoned from the code, and the symptom outlived all of them.
    //
    // So this stops reasoning. A timestamp makes the URL unique per request,
    // which no browser cache, edge cache or service worker can have a stored
    // copy of. If the page still reads zero after this, caching is not the
    // cause and never was — which is worth knowing for certain, and cannot be
    // established by reading configuration.
    //
    // The cost is real and accepted: catalogue reads no longer collapse onto
    // the edge cache, so they reach the origin. Remove this once the cause is
    // confirmed and fixed at its root.
    const bust = url.includes('?') ? '&' : '?';

    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
      try {
        return await firstValueFrom(this.http.get<T>(`${url}${bust}_=${Date.now()}`));
      } catch (err) {
        const noAnswer = err instanceof HttpErrorResponse && err.status === 0;
        const last = attempt === FETCH_ATTEMPTS;
        // Logged on every attempt: "failed once then succeeded" and "failed
        // three times" are different faults, and a log that records only the
        // last one cannot tell them apart.
        console.error(
          `Catalogue source failed (${url}) [attempt ${attempt}/${FETCH_ATTEMPTS}]:`,
          err,
        );
        if (last) this.lastFailure.set(describeFailure(url, err));
        if (!noAnswer || last) return null;
        await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_MS));
      }
    }
    return null;
  }

  /**
   * Fetch every page of a paginated source, not just the first.
   *
   * The API caps page_size at 100 and orders the catalogue by make, so asking
   * for one page of 100 quietly published an alphabetical prefix of it. With
   * ~155 models, everything from Maruti Suzuki onwards was missing from New
   * Cars — a car could be priced, photographed and correct, and still never
   * appear, because Honda through Mahindra had used up the page.
   *
   * A truncated catalogue is worse than a slow one: nothing about the page
   * says a model is absent, so the fault looks like a broken upload.
   *
   * `total` bounds the loop, and a short page ends it early, so a source that
   * miscounts cannot spin forever.
   */
  private async fetchAllPages<T extends { items: unknown[]; total: number }>(
    url: string,
  ): Promise<T | null> {
    const PAGE_SIZE = 100;
    const MAX_PAGES = 50;  // 5,000 models, well past any real catalogue.
    const sep = url.includes('?') ? '&' : '?';

    const first = await this.fetchOrNull<T>(`${url}${sep}page=1&page_size=${PAGE_SIZE}`);
    if (!first) return null;

    const items = [...first.items];
    for (let page = 2; items.length < (first.total ?? 0) && page <= MAX_PAGES; page++) {
      const next = await this.fetchOrNull<T>(`${url}${sep}page=${page}&page_size=${PAGE_SIZE}`);
      if (!next?.items?.length) break;  // A failed or empty page ends it.
      items.push(...next.items);
    }

    return { ...first, items } as T;
  }

  private async load() {
    this.loading.set(true);
    this.failedSources.set([]);
    this.lastFailure.set('');
    try {
      // Three independent sources, fetched independently. Promise.all would
      // reject the whole load when any one of them failed, so a broken
      // /listings emptied the New Cars pages too — even though the catalogue
      // they are built from had answered perfectly well. A source that fails
      // now costs only its own rows.
      const [newResp, usedResp, catalogueResp] = await Promise.all([
        this.fetchAllPages<ApiListResponse>(
          `${this.apiUrl}/listings?listing_type=new`
        ),
        this.fetchAllPages<ApiListResponse>(
          `${this.apiUrl}/listings?listing_type=used`
        ),
        // The catalogue of manufacturer models, which is where admin-uploaded
        // photography lands. Without this the New Cars pages could only show
        // models some seller had happened to advertise, so an uploaded image
        // had no route to a buyer. priced_only keeps models nobody has priced
        // out of a grid that sorts and filters on price.
        this.fetchAllPages<ApiCarListResponse>(
          `${this.apiUrl}/cars?bucket=new&priced_only=true`
        ),
      ]);

      // fetchAllPages returns null for a source that failed, as distinct from
      // one that answered with nothing. Recorded before the rows are mapped,
      // because after that point the two are indistinguishable — both are an
      // empty array.
      const failed: ('new' | 'used' | 'catalogue')[] = [];
      if (newResp === null) failed.push('new');
      if (usedResp === null) failed.push('used');
      if (catalogueResp === null) failed.push('catalogue');
      this.failedSources.set(failed);

      // Every source down is an outage rather than an empty catalogue, and the
      // two deserve different treatment — see the fallback below.
      if (newResp === null && usedResp === null && catalogueResp === null) {
        throw new Error('every catalogue source failed');
      }

      const newCars = (newResp?.items ?? []).map(mapListing);
      const usedCars = (usedResp?.items ?? []).map(mapListing);

      // A model that a seller has already advertised wins: that row carries a
      // real advert a buyer can act on, and showing both would put the same
      // car on the page twice at two different prices.
      //
      // Only an advert that will actually be shown may do the suppressing.
      // The New Cars pages display a car with no odometer reading, and an
      // advert filed under listing_type=new does not have to have one — a
      // seller can list a driven car as new. Such a row was hidden by the
      // page's own filter and still claimed the model's identity, so the
      // catalogue entry it stood for vanished with it: no advert, no catalogue
      // model, and nothing anywhere saying why.
      //
      // Model year needs no such guard: it is part of the identity, so an
      // advert for a different year cannot collide with the catalogue row.
      const advertised = new Set(
        newCars.filter(c => c.km === 0).map(variantKey)
      );
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
      this.failedSources.set(['new', 'used', 'catalogue']);
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

  /**
   * The trims a model is sold in, as buyers see them.
   *
   * Published only: a draft is a figure a language model produced and nobody
   * has read. Returns [] on any failure, so a page renders without a variants
   * section rather than not at all.
   */
  async variantsFor(carId: string): Promise<CarVariant[]> {
    const rows = await this.fetchOrNull<CarVariant[]>(
      `${this.apiUrl}/cars/${carId}/variants`,
    );
    return rows ?? [];
  }

  /**
   * One car in full: every photograph it has, plus the specification and
   * feature list curated against it.
   *
   * /cars caps the images it returns per car, because a hundred-car page would
   * otherwise haul thousands of URLs across the wire. A detail page is showing
   * one car and wants all of it: an admin who uploads a fifteenth photograph
   * and finds eight on the page concludes the upload failed.
   *
   * Returns null when the car is not a catalogue model or the request fails,
   * so the caller keeps whatever it already had.
   */
  async fullCar(id: string): Promise<Partial<Car> | null> {
    const car = await this.fetchOrNull<ApiCar>(`${this.apiUrl}/cars/${id}`);
    if (!car) return null;
    return {
      images: (car.image_urls ?? []).filter(
        u => u && !u.includes('media.gaadiiq.com') && !u.includes('picsum'),
      ),
      spinImages: car.spin_urls ?? [],
      specs: car.specs ?? undefined,
      features: car.features ?? undefined,
      variantCount: car.variant_count ?? 0,
      variantPriceMin: rupeesOrUndefined(car.variant_price_min),
      variantPriceMax: rupeesOrUndefined(car.variant_price_max),
    };
  }

  addApprovedVehicle(car: Car): void {
    // Avoid duplicates by id
    if (this._cars().some(c => c.id === car.id)) return;
    this._cars.update(list => [car, ...list]);
  }
}
