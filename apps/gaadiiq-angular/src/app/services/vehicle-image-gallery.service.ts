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

  /** Identity the current images were loaded for; null when nothing is loaded. */
  private loadedFor: string | null = null;
  /** Guards against overlapping loads while one is already in flight. */
  private inFlight = false;

  constructor(private auth: AuthService) {
    // Load images when an admin signs in.
    //
    // currentUser holds an object and signals compare by reference, so every
    // currentUser.set({...}) re-triggers this effect even when the same person
    // is still signed in — and Supabase re-sets it on token refresh and other
    // auth events, some of which getSession() below can itself provoke. Reacting
    // to the object directly therefore looped: load -> auth event -> new object
    // -> effect -> load, several requests per second against the API.
    //
    // Depend on a primitive identity string instead, and skip when it has not
    // changed, so a re-emitted but equivalent user is a no-op.
    effect(() => {
      const user = this.auth.currentUser();
      const identity = user && this.auth.isAdmin() ? (user.email ?? null) : null;

      if (identity === null) {
        this.loadedFor = null;
        return;
      }
      if (identity === this.loadedFor) {
        return;
      }
      this.loadedFor = identity;
      void this.loadDealerImages();
    });
  }

  async loadDealerImages(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    this.loading.set(true);
    this.error.set(null);

    try {
      // Read the injected client, not a `window.supabaseClient` global — that
      // global is never assigned, so this sent "Bearer undefined" and every
      // gallery load failed with 401 while the user appeared signed in.
      const { data: sessionData } = await this.supabase.client.auth.getSession();
      const token = sessionData.session?.access_token;

      // Without a token the API can only answer 401, so do not spend the
      // request. Clear loadedFor so the next real sign-in retries.
      if (!token) {
        this.loadedFor = null;
        this.error.set('Not signed in');
        return;
      }

      const response = await fetch(`${environment.apiUrl}/media-admin/dealer-images`, {
        headers: { Authorization: `Bearer ${token}` },
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
      this.inFlight = false;
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
