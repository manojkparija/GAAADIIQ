import { Injectable, signal, effect, inject } from '@angular/core';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { environment } from '../../environments/environment';

interface DealerImage {
  id: string;
  filename: string;
  url: string;
  thumbnail_url: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  model_year: number | null;
  image_category: string | null;
  colour: string | null;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class VehicleImageGalleryService {
  images = signal<DealerImage[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);

  private supabase = inject(SupabaseService);

  constructor(private auth: AuthService) {
    // Load images when admin logs in
    effect(() => {
      const user = this.auth.currentUser();
      if (user && this.auth.isAdmin()) {
        this.loadDealerImages();
      }
    });
  }

  async loadDealerImages(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      // Read the injected client, not a `window.supabaseClient` global — that
      // global is never assigned, so this sent "Bearer undefined" and every
      // gallery load failed with 401 while the user appeared signed in.
      const { data: sessionData } = await this.supabase.client.auth.getSession();
      const token = sessionData.session?.access_token;

      const response = await fetch(`${environment.apiUrl}/media-admin/dealer-images`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        throw new Error(`Failed to load images: ${response.status}`);
      }

      const data = await response.json();
      this.images.set(data.images || []);
    } catch (err) {
      this.error.set(String(err));
      console.error('Failed to load dealer images:', err);
    } finally {
      this.loading.set(false);
    }
  }

  getImageCount(): number {
    return this.images().length;
  }

  getRecentImages(limit: number = 12): DealerImage[] {
    return this.images().slice(0, limit);
  }

  getImagesByCategory(category: string): DealerImage[] {
    return this.images().filter(img => img.image_category === category);
  }

  getImagesByVehicle(make: string, model: string): DealerImage[] {
    return this.images().filter(img => img.make === make && img.model === model);
  }
}
