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

  // Fallback dummy seller shown when DB isn't set up yet
  private readonly DUMMY: Seller = {
    id: 1,
    name: 'Rajesh Kumar',
    business_name: 'RK Motors',
    phone: '+91 98765 43210',
    email: 'rajesh@rkmotors.in',
    city: 'Mumbai',
    address: 'Shop 12, Andheri West, Mumbai',
    verified: true,
    rating: 4.8,
    total_reviews: 312,
  };

  constructor(private sb: SupabaseService) {}

  async getById(sellerId: number): Promise<Seller> {
    if (this.cache.has(String(-sellerId))) return this.cache.get(String(-sellerId))!;
    const { data, error } = await this.sb.client
      .from('sellers')
      .select('*')
      .eq('id', sellerId)
      .single();
    const seller: Seller = (!error && data) ? data : { ...this.DUMMY, id: sellerId };
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

  async getForCar(carId: string): Promise<Seller> {
    if (this.cache.has(carId)) return this.cache.get(carId)!;

    // Try to find a mapped seller; fall back to round-robin from sellers table
    const { data: map } = await this.sb.client
      .from('car_seller_map')
      .select('seller_id')
      .eq('car_id', carId)
      .single();

    let sellerId: number = map?.seller_id ?? 1;

    const { data, error } = await this.sb.client
      .from('sellers')
      .select('*')
      .eq('id', sellerId)
      .single();

    const seller: Seller = (!error && data) ? data : { ...this.DUMMY, id: sellerId };
    this.cache.set(carId, seller);
    return seller;
  }
}
