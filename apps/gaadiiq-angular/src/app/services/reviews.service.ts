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

@Injectable({ providedIn: 'root' })
export class ReviewsService {
  loading = signal(false);
  uploading = signal(false);

  constructor(private sb: SupabaseService) {}

  async getReviewsForCar(carId: string): Promise<CarReview[]> {
    this.loading.set(true);
    const { data, error } = await this.sb.client
      .from('car_reviews')
      .select('*')
      .eq('car_id', carId)
      .order('created_at', { ascending: false });
    this.loading.set(false);
    if (error) { console.error(error); return []; }
    return data ?? [];
  }

  async submitReview(review: Omit<CarReview, 'id' | 'likes' | 'created_at'>): Promise<CarReview | null> {
    const { data: { user } } = await this.sb.client.auth.getUser();
    const { data, error } = await this.sb.client
      .from('car_reviews')
      .insert({ ...review, user_id: user?.id ?? null, likes: 0 })
      .select()
      .single();
    if (error) { console.error(error); return null; }
    return data;
  }

  async uploadVideo(file: File, carId: string): Promise<string | null> {
    this.uploading.set(true);
    const ext = file.name.split('.').pop();
    const path = `${carId}/${Date.now()}.${ext}`;
    const { error } = await this.sb.client.storage
      .from('review-videos')
      .upload(path, file, { cacheControl: '3600', upsert: false });
    this.uploading.set(false);
    if (error) { console.error(error); return null; }
    const { data } = this.sb.client.storage.from('review-videos').getPublicUrl(path);
    return data.publicUrl;
  }

  async toggleLike(reviewId: string, liked: boolean): Promise<void> {
    const { data: { user } } = await this.sb.client.auth.getUser();
    if (!user) return;
    if (liked) {
      await this.sb.client.from('review_likes').delete()
        .eq('review_id', reviewId).eq('user_id', user.id);
      await this.sb.client.from('car_reviews')
        .update({ likes: this.sb.client.rpc as any })
        .eq('id', reviewId);
      // simple decrement via rpc-free approach:
      const { data } = await this.sb.client.from('car_reviews').select('likes').eq('id', reviewId).single();
      if (data) await this.sb.client.from('car_reviews').update({ likes: Math.max(0, data.likes - 1) }).eq('id', reviewId);
    } else {
      await this.sb.client.from('review_likes').insert({ review_id: reviewId, user_id: user.id });
      const { data } = await this.sb.client.from('car_reviews').select('likes').eq('id', reviewId).single();
      if (data) await this.sb.client.from('car_reviews').update({ likes: data.likes + 1 }).eq('id', reviewId);
    }
  }

  async hasLiked(reviewId: string): Promise<boolean> {
    const { data: { user } } = await this.sb.client.auth.getUser();
    if (!user) return false;
    const { data } = await this.sb.client.from('review_likes')
      .select('review_id').eq('review_id', reviewId).eq('user_id', user.id).maybeSingle();
    return !!data;
  }
}
