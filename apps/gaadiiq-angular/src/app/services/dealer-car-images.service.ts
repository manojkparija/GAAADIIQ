import { Injectable, signal } from '@angular/core';

import { SupabaseService } from './supabase.service';
import { ImageUploadService } from './image-upload.service';

/**
 * The photographs on one dealer's own listing.
 *
 * Deliberately not the admin media library. `vehicle_media` is the shared
 * catalogue, matched on make + model + year, and a picture in it appears on
 * every car of that model on the site — one dealer's photograph would end up
 * on a competitor's listing. These are `car_images` rows, tied to a single
 * `cars.id`, which is what a dealer actually means by "my car's photos".
 *
 * The dashboard used to show the catalogue here and send dealers to
 * /admin/car-images to add to it, which they cannot open: it sits behind
 * adminGuard.
 */

export interface DealerCarImage {
  id: number;
  car_id: number;
  url: string;
  sort_order: number | null;
}

@Injectable({ providedIn: 'root' })
export class DealerCarImagesService {
  images = signal<DealerCarImage[]>([]);
  loading = signal(false);
  error = signal('');

  constructor(
    private sb: SupabaseService,
    private uploader: ImageUploadService,
  ) {}

  async load(carId: number): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    const { data, error } = await this.sb.client
      .from('car_images')
      .select('id, car_id, url, sort_order')
      .eq('car_id', carId)
      .order('sort_order', { ascending: true });

    this.loading.set(false);
    if (error) {
      this.error.set('Could not load photos for this car.');
      this.images.set([]);
      return;
    }
    this.images.set((data ?? []) as DealerCarImage[]);
  }

  /**
   * Put files in storage, then record them against the car.
   *
   * Two steps that can fail independently. If the row insert is refused —
   * which is how row-level security says "not your car", by returning nothing
   * rather than raising — the uploaded file is left in the bucket but claimed
   * by nobody, and saying so is better than reporting a success the gallery
   * will not show.
   */
  async add(carId: number, files: File[]): Promise<boolean> {
    if (!files.length) return true;
    this.loading.set(true);
    this.error.set('');

    try {
      const uploaded = await this.uploader.uploadFiles(files, `listings/${carId}`);
      const startAt = this.images().length;

      const { data, error } = await this.sb.client
        .from('car_images')
        .insert(uploaded.map((img, i) => ({
          car_id: carId, url: img.url, sort_order: startAt + i,
        })))
        .select();

      if (error || !data?.length) {
        this.error.set('Those photos could not be attached to this car.');
        return false;
      }

      this.images.update(list => [...list, ...(data as DealerCarImage[])]);
      return true;
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Upload failed.');
      return false;
    } finally {
      this.loading.set(false);
    }
  }

  async remove(imageId: number): Promise<boolean> {
    this.error.set('');
    const { data, error } = await this.sb.client
      .from('car_images')
      .delete()
      .eq('id', imageId)
      .select();

    // A delete refused by row-level security removes nothing and reports no
    // error. Without checking what came back, the photo would vanish from the
    // screen and reappear on the next load.
    if (error || !data?.length) {
      this.error.set('That photo could not be removed.');
      return false;
    }

    this.images.update(list => list.filter(i => i.id !== imageId));
    return true;
  }
}
