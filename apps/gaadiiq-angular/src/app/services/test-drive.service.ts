import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface TestDriveRequest {
  id?: number;
  car_id: number;
  car_make: string;
  car_model: string;
  car_year: number;
  buyer_name: string;
  buyer_phone: string;
  buyer_email?: string;
  preferred_date: string;
  preferred_time: string;
  location?: string;
  notes?: string;
  seller_id?: number;
  status?: string;
  created_at?: string;
}

@Injectable({ providedIn: 'root' })
export class TestDriveService {
  requests = signal<TestDriveRequest[]>([]);

  constructor(private sb: SupabaseService) {}

  async submit(req: TestDriveRequest): Promise<boolean> {
    const { error } = await this.sb.client
      .from('test_drive_requests')
      .insert(req);
    return !error;
  }

  async loadForSeller(sellerId: number | null, isAdmin: boolean) {
    let query = this.sb.client
      .from('test_drive_requests')
      .select('*')
      .order('created_at', { ascending: false });

    // Admin sees all; seller sees only their own
    if (!isAdmin && sellerId) {
      query = query.eq('seller_id', sellerId);
    }

    const { data, error } = await query;
    if (!error && data) this.requests.set(data);
  }

  // Legacy: load all (admin use)
  async loadAll() {
    const { data, error } = await this.sb.client
      .from('test_drive_requests')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) this.requests.set(data);
  }
}
