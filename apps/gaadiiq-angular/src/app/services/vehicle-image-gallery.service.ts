import { Injectable, signal, effect } from '@angular/core';
import { AuthService } from './auth.service';

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
      const token = await (window as any).supabaseClient?.auth.getSession()
        .then((s: any) => s?.data?.session?.access_token);

      const response = await fetch('http://localhost:8000/media-admin/dealer-images', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
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
