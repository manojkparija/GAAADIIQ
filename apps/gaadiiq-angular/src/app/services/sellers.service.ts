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
  private cache = new Map<number, Seller>();

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
    if (this.cache.has(-sellerId)) return this.cache.get(-sellerId)!;
    const { data, error } = await this.sb.client
      .from('sellers')
      .select('*')
      .eq('id', sellerId)
      .single();
    const seller: Seller = (!error && data) ? data : { ...this.DUMMY, id: sellerId };
    this.cache.set(-sellerId, seller);
    return seller;
  }

  async getByEmail(email: string): Promise<Seller | null> {
    const { data, error } = await this.sb.client
      .from('sellers')
      .select('*')
      .eq('email', email)
      .single();
    if (error || !data) return null;
    this.cache.set(-data.id, data);
    return data;
  }

  async getForCar(carId: number): Promise<Seller> {
    if (this.cache.has(carId)) return this.cache.get(carId)!;

    // Try to find a mapped seller; fall back to round-robin from sellers table
    const { data: map } = await this.sb.client
      .from('car_seller_map')
      .select('seller_id')
      .eq('car_id', carId)
      .single();

    let sellerId: number = map?.seller_id ?? ((carId % 8) + 1);

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
