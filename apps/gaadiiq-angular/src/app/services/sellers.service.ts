import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface Seller {
  id: number;
  name: string;
  business_name: string;
  phone: string;
  email: string;
  city: string;
  address: string;
  verified: boolean;
  rating: number;
  total_reviews: number;
}

@Injectable({ providedIn: 'root' })
export class SellersService {
  private cache = new Map<string, Seller>();

  // There was a fallback dealer here — "Rajesh Kumar, RK Motors, Verified
  // Dealer, 4.8 stars, 312 reviews, +91 98765 43210" — substituted whenever a
  // real seller could not be found. It was reported from the live site by
  // somebody who knew that dealer did not exist.
  //
  // It has been removed rather than corrected. Every field of it was invented:
  // the badge claimed verification nobody performed, the rating averaged
  // reviews nobody wrote, and the phone number was one a buyer could ring. A
  // placeholder that is indistinguishable from a real record is not a
  // placeholder; it is a fabrication the interface presents as fact.
  //
  // These methods now return null when there is no seller. That is a real
  // state — a catalogue car is manufacturer stock and has no dealer behind it
  // — and callers are expected to say so rather than fill the gap.

  constructor(private sb: SupabaseService) {}

  async getById(sellerId: number): Promise<Seller | null> {
    if (this.cache.has(String(-sellerId))) return this.cache.get(String(-sellerId))!;
    const { data, error } = await this.sb.client
      .from('sellers')
      .select('*')
      .eq('id', sellerId)
      .single();
    if (error || !data) return null;
    const seller = data as Seller;
    this.cache.set(String(-sellerId), seller);
    return seller;
  }

  /**
   * Every dealer, for an admin choosing who to hand an enquiry to (027).
   *
   * Not cached: the whole point of this list is that it grows as dealers are
   * onboarded, and a cached copy would leave an admin unable to assign to the
   * dealer who joined this morning.
   *
   * Returns [] rather than the dummy on failure. A fabricated dealer in an
   * assignment dropdown is a lead sent to a business that does not exist —
   * far worse than an empty list, which at least says "nobody yet".
   */
  async listAll(): Promise<Seller[]> {
    const { data, error } = await this.sb.client
      .from('sellers')
      .select('*')
      .order('business_name');
    if (error || !data) return [];
    return data as Seller[];
  }

  async getByEmail(email: string): Promise<Seller | null> {
    const { data, error } = await this.sb.client
      .from('sellers')
      .select('*')
      .eq('email', email)
      .single();
    if (error || !data) return null;
    this.cache.set(String(-data.id), data);
    return data;
  }

  /**
   * The dealer selling this car, or null when nobody is.
   *
   * REPORTED FROM THE LIVE SITE: a dealer shown on a car page who does not
   * exist. Two separate inventions produced that, and both are gone.
   *
   * The first was `map?.seller_id ?? 1`. With no mapping for a car this fell
   * back to dealer number one — an arbitrary business with no connection to
   * the vehicle. Where a real dealer holds id 1, every unmapped car in the
   * catalogue was attributed to them, and they would take calls about stock
   * they have never sold.
   *
   * The second was the fabricated dealer this class used to carry, substituted
   * when even that lookup failed.
   *
   * Null is the honest answer and it is a real state, not an error: a
   * catalogue row is manufacturer stock, and manufacturer stock has no dealer
   * behind it. Saying so is what lets an enquiry reach the people who can
   * actually act on it.
   */
  async getForCar(carId: string): Promise<Seller | null> {
    if (this.cache.has(carId)) return this.cache.get(carId)!;

    const { data: map } = await this.sb.client
      .from('car_seller_map')
      .select('seller_id')
      .eq('car_id', carId)
      .maybeSingle();

    // No mapping means no dealer. It does not mean dealer one.
    if (!map?.seller_id) return null;

    const { data, error } = await this.sb.client
      .from('sellers')
      .select('*')
      .eq('id', map.seller_id)
      .single();

    if (error || !data) return null;
    const seller = data as Seller;
    this.cache.set(carId, seller);
    return seller;
  }
}
