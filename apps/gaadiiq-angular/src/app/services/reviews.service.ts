import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface CarReview {
  id?: string;
  car_id: string;
  user_id?: string;
  user_name: string;
  user_city: string;
  avatar: string;
  rating: number;
  title: string;
  body: string;
  video_url?: string | null;
  likes: number;
  created_at?: string;
}

const LS_KEY = 'gaadiiq_reviews';

@Injectable({ providedIn: 'root' })
export class ReviewsService {
  loading = signal(false);
  uploading = signal(false);
  useLocalFallback = false;

  constructor(private sb: SupabaseService) {}

  // ── Read ──────────────────────────────────────────────────────────────────

  async getReviewsForCar(carId: string): Promise<CarReview[]> {
    this.loading.set(true);
    try {
      const { data, error } = await this.sb.client
        .from('car_reviews')
        .select('*')
        .eq('car_id', carId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      this.loading.set(false);
      // merge with any local-fallback reviews for this car
      const local = this.localReviews().filter(r => r.car_id === carId);
      return [...local, ...(data ?? [])];
    } catch (err) {
      console.warn('Supabase unavailable, using local storage', err);
      this.useLocalFallback = true;
      this.loading.set(false);
      return this.localReviews().filter(r => r.car_id === carId);
    }
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  async submitReview(review: Omit<CarReview, 'id' | 'likes' | 'created_at'>): Promise<CarReview | null> {
    const newReview: CarReview = {
      ...review,
      id: crypto.randomUUID(),
      likes: 0,
      created_at: new Date().toISOString(),
    };

    // Try Supabase first
    if (!this.useLocalFallback) {
      try {
        const { data, error } = await this.sb.client
          .from('car_reviews')
          .insert({ ...newReview, user_id: null })
          .select()
          .single();

        if (error) throw error;
        return data;
      } catch (err: any) {
        console.warn('Supabase insert failed, saving locally:', err?.message ?? err);
        this.useLocalFallback = true;
      }
    }

    // Local storage fallback
    this.saveLocalReview(newReview);
    return newReview;
  }

  // ── Video upload ──────────────────────────────────────────────────────────

  async uploadVideo(file: File, carId: string): Promise<string | null> {
    this.uploading.set(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${carId}/${Date.now()}.${ext}`;
      const { error } = await this.sb.client.storage
        .from('review-videos')
        .upload(path, file, { cacheControl: '3600', upsert: false });
      this.uploading.set(false);
      if (error) throw error;
      const { data } = this.sb.client.storage.from('review-videos').getPublicUrl(path);
      return data.publicUrl;
    } catch (err) {
      console.warn('Video upload failed — review will be saved without video', err);
      this.uploading.set(false);
      return null;
    }
  }

  // ── Local storage helpers ─────────────────────────────────────────────────

  private localReviews(): CarReview[] {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
  }

  private saveLocalReview(review: CarReview) {
    const all = this.localReviews();
    localStorage.setItem(LS_KEY, JSON.stringify([review, ...all]));
  }
}
