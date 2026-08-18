import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface TestDriveRequest {
  id?: number;
  car_id: string;
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
  outcome?: string | null;
  outcome_notes?: string | null;
  completed_at?: string | null;
  created_at?: string;
}

/** Did the appointment happen? */
export const TEST_DRIVE_STATUSES = [
  'Pending', 'Confirmed', 'Completed', 'Cancelled', 'No-show',
] as const;

/**
 * Did it turn into a sale?
 *
 * Deliberately a second axis rather than more values on `status`. Merged into
 * one list, a buyer who never turned up and a buyer who drove the car and
 * walked away would be the same row, and there would be nowhere to record a
 * car that sold without a test drive at all.
 */
export const TEST_DRIVE_OUTCOMES = ['Won', 'Lost', 'Deciding'] as const;

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
    // Seller with unknown ID → show nothing (sellers table not seeded yet)
    if (!isAdmin && !sellerId) {
      this.requests.set([]);
      return;
    }

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

  /**
   * Move a request along, and record the sale when one happens.
   *
   * Writes through to the row and updates the local signal on success only —
   * an optimistic update here would show a dealer a status the database
   * refused, and RLS refusals come back as zero rows updated rather than as
   * an error.
   */
  async update(
    id: number,
    changes: { status?: string; outcome?: string | null; outcome_notes?: string | null },
  ): Promise<boolean> {
    const patch: Record<string, unknown> = { ...changes, updated_at: new Date().toISOString() };

    // Stamped when the drive is first marked Completed, so "how long from
    // request to drive" is answerable later. Not cleared by a later edit —
    // the drive still happened.
    if (changes.status === 'Completed') patch['completed_at'] = new Date().toISOString();

    // An outcome only means something once the drive happened. Moving a row
    // back to Pending or Cancelled clears it rather than leaving a "Won"
    // hanging off an appointment that did not take place.
    if (changes.status && changes.status !== 'Completed') {
      patch['outcome'] = null;
    }

    const { data, error } = await this.sb.client
      .from('test_drive_requests')
      .update(patch)
      .eq('id', id)
      .select();

    if (error || !data?.length) return false;

    this.requests.update(list =>
      list.map(r => (r.id === id ? { ...r, ...(data[0] as TestDriveRequest) } : r)),
    );
    return true;
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
