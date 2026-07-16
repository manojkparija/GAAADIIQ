export type FuelType = "petrol" | "diesel" | "electric" | "cng" | "hybrid";
export type Transmission = "manual" | "automatic" | "amt" | "cvt" | "dct";
export type BodyType = "hatchback" | "sedan" | "suv" | "muv" | "coupe" | "convertible";
export type ListingType = "new" | "used";
export type ListingCondition = "excellent" | "good" | "fair" | "poor";

export interface Car {
  id: string;
  make: string;
  model: string;
  variant: string | null;
  year: number;
  fuel_type: FuelType | null;
  transmission: Transmission | null;
  body_type: BodyType | null;
  seating_capacity: number | null;
  engine_cc: number | null;
  created_at: string;
}

/** Public seller shape — matches API UserPublicOut (no email/phone). */
export interface Seller {
  id: string;
  full_name: string | null;
  role: string;
  created_at: string;
}

export interface Listing {
  id: string;
  listing_type: ListingType;
  price: number;
  negotiable: boolean;
  km_driven: number | null;
  registration_year: number | null;
  registration_state: string | null;
  owners_count: number | null;
  condition: ListingCondition | null;
  city: string | null;
  description: string | null;
  is_active: boolean;
  is_featured: boolean;
  views_count: number;
  ai_valuation: number | null;
  ai_method: string | null;
  ai_confidence: string | null;
  ai_reasoning: string | null;
  image_urls: string[];
  car: Car;
  seller: Seller;
  created_at: string;
  updated_at: string;
}

export interface ListingListResponse {
  items: Listing[];
  total: number;
  page: number;
  page_size: number;
}

export interface ListingFilters {
  listing_type?: ListingType;
  city?: string;
  make?: string;
  model?: string;
  fuel_type?: FuelType;
  body_type?: BodyType;
  min_price?: number;
  max_price?: number;
  min_year?: number;
  max_year?: number;
  max_km?: number;
  page?: number;
  page_size?: number;
}
