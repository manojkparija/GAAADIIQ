import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

/** A brand as the admin screen sees it — every column, not just the four the grid renders. */
export interface AdminBrand {
  id: number;
  name: string;
  slug: string;
  logo_url: string | null;
  country: string | null;
  sort_order: number | null;
  active: boolean;
  logo_storage_path: string | null;
  logo_updated_at: string | null;
  logo_updated_by: string | null;
}

/** Where a row's current logo comes from. Derived, not stored — see `origin()`. */
export type LogoOrigin = 'uploaded' | 'cdn' | 'bundled' | 'none';

@Injectable({ providedIn: 'root' })
export class BrandLogoService {
  private sb = inject(SupabaseService);

  private readonly bucket = 'brand-logos';

  /**
   * SVG first, because a logo is line art and the grid renders it at ~44px on a
   * phone and ~64px on a desktop — a raster at one size is wrong at the other.
   * PNG and WebP are accepted for the brands whose owners only publish raster.
   *
   * JPEG is deliberately absent: it has no transparency, so it lands as a white
   * or black rectangle inside the circular tile.
   */
  readonly acceptedTypes = ['image/svg+xml', 'image/png', 'image/webp'];
  readonly acceptAttr = '.svg,.png,.webp';

  /** 512 KB. A brand mark that needs more than this is a photograph by mistake. */
  readonly maxBytes = 512 * 1024;

  async list(): Promise<AdminBrand[]> {
    const { data, error } = await this.sb.client
      .from('brands')
      .select('id, name, slug, logo_url, country, sort_order, active, logo_storage_path, logo_updated_at, logo_updated_by')
      .order('sort_order');

    if (error) throw new Error(error.message);
    return (data ?? []) as AdminBrand[];
  }

  /**
   * Which of the three sources this row's logo is on.
   *
   * Read off the URL rather than trusted from logo_storage_path, because the
   * rows written by 002/003/004 predate that column and all have it NULL — so
   * trusting it would report every pre-existing logo as "none".
   */
  origin(brand: Pick<AdminBrand, 'logo_url'>): LogoOrigin {
    const url = brand.logo_url ?? '';
    if (!url) return 'none';
    // The full storage path, not just the bucket name.
    //
    // Matching on `/brand-logos/` alone reported the bundled assets as
    // uploaded, because the folder committed to the repo is
    // `assets/brand-logos/` — the same word. Mahindra, which 004 deliberately
    // put on a repo file, showed as "Uploaded", i.e. the screen said the one
    // logo that needs a deploy to change could be replaced from here.
    if (url.includes(`/storage/v1/object/public/${this.bucket}/`)) return 'uploaded';
    if (/^https?:\/\//.test(url)) return 'cdn';
    return 'bundled';
  }

  /**
   * Reject before uploading, with the reason.
   *
   * Returns null when the file is fine. The bucket's policies would refuse a
   * non-admin anyway, but nothing server-side checks that a 40MB JPEG is a
   * sensible brand logo, and finding out after the upload wastes the round trip
   * and leaves the object behind.
   */
  rejectionReason(file: File): string | null {
    // Some browsers report an empty type for .svg from certain file pickers, so
    // the extension is a fallback rather than the primary check.
    const type = file.type;
    const looksSvg = !type && file.name.toLowerCase().endsWith('.svg');

    if (!looksSvg && !this.acceptedTypes.includes(type)) {
      return `${type || 'That file type'} is not a logo format. Use SVG, PNG or WebP — JPEG has no transparency and shows as a rectangle in the tile.`;
    }
    if (file.size > this.maxBytes) {
      const kb = Math.round(file.size / 1024);
      return `That file is ${kb} KB. Logos are capped at ${this.maxBytes / 1024} KB — anything larger is a photograph rather than a mark.`;
    }
    if (file.size === 0) return 'That file is empty.';
    return null;
  }

  /**
   * Upload a logo and point the brand row at it.
   *
   * The object key carries a timestamp rather than being just the slug. Supabase
   * serves storage through a CDN, so overwriting `tata.svg` in place leaves the
   * old image cached at the same URL and the admin sees no change and uploads
   * again. A new key each time makes the URL change, which is what actually
   * busts the cache.
   *
   * The previous uploaded object is removed afterwards, and only if it was one
   * of ours — a CDN URL or a bundled assets/ path has no object to delete.
   */
  async uploadLogo(brand: AdminBrand, file: File, uploadedBy: string | null): Promise<AdminBrand> {
    const reason = this.rejectionReason(file);
    if (reason) throw new Error(reason);

    const ext = file.name.split('.').pop()?.toLowerCase() || 'svg';
    const key = `${brand.slug}-${Date.now()}.${ext}`;

    const { error: upErr } = await this.sb.client.storage
      .from(this.bucket)
      .upload(key, file, {
        contentType: file.type || 'image/svg+xml',
        upsert: false,
        // A year. The key already changes on every upload, so a long cache is
        // safe and keeps the homepage's logos out of the network on repeat
        // visits.
        cacheControl: '31536000',
      });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    const { data: pub } = this.sb.client.storage.from(this.bucket).getPublicUrl(key);

    const previous = brand.logo_storage_path;

    const { data, error } = await this.sb.client
      .from('brands')
      .update({
        logo_url: pub.publicUrl,
        logo_storage_path: key,
        logo_updated_at: new Date().toISOString(),
        logo_updated_by: uploadedBy,
      })
      .eq('id', brand.id)
      .select()
      .single();

    if (error) {
      // The row still points at the old logo, so leaving the new object behind
      // would be an orphan nothing references. Clean it up, but report the
      // update failure — that is the one the admin needs to hear about.
      await this.removeQuietly(key);
      throw new Error(`Uploaded, but could not update the brand: ${error.message}`);
    }

    if (previous && previous !== key) {
      // Best effort. A leftover object costs a few KB; failing the whole
      // operation because the old file would not delete costs the admin their
      // change.
      await this.removeQuietly(previous);
    }

    return data as AdminBrand;
  }

  /**
   * Delete an object, swallowing any failure.
   *
   * try/catch rather than .catch(): only the resolved value is guaranteed here,
   * and a rejection thrown while cleaning up would replace the error the caller
   * is actually trying to report.
   */
  private async removeQuietly(key: string): Promise<void> {
    try {
      await this.sb.client.storage.from(this.bucket).remove([key]);
    } catch {
      /* a leftover object costs a few KB; losing the real error costs more */
    }
  }

  /** Set logo_url by hand — for pointing a brand at a CDN or a bundled asset. */
  async setLogoUrl(brand: AdminBrand, url: string, updatedBy: string | null): Promise<AdminBrand> {
    const { data, error } = await this.sb.client
      .from('brands')
      .update({
        logo_url: url.trim() || null,
        // The row no longer points at the uploaded object, so the path must not
        // keep claiming it does — otherwise the next upload deletes a file this
        // row has already stopped using, or worse, one another row now uses.
        logo_storage_path: null,
        logo_updated_at: new Date().toISOString(),
        logo_updated_by: updatedBy,
      })
      .eq('id', brand.id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as AdminBrand;
  }

  async setActive(brand: AdminBrand, active: boolean): Promise<AdminBrand> {
    const { data, error } = await this.sb.client
      .from('brands')
      .update({ active })
      .eq('id', brand.id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as AdminBrand;
  }
}
