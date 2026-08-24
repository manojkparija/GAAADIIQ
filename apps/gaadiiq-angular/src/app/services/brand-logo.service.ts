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
   * Is the image sitting on a solid background?
   *
   * WHY THIS EXISTS
   *
   * The first logo uploaded through this screen was a PNG on white. The grid
   * renders every logo inside a round tile on a dark surface, so it appeared as
   * a white SQUARE in a row of marks that float on the tile — the upload worked
   * perfectly and the result still looked broken. Nothing in the file is
   * invalid, so no format or size check could have caught it.
   *
   * The test is deliberately narrow: all four corners opaque AND near-identical
   * in colour. A brand mark that reaches every corner of its own canvas in one
   * flat colour is not something that happens by accident, so a positive here
   * is a background rather than artwork.
   *
   * Returns null when the image is fine, or when it could not be examined —
   * a browser that will not decode the file must not turn into a refusal to
   * upload it.
   */
  async solidBackgroundColour(file: File): Promise<string | null> {
    let url: string | null = null;
    try {
      url = URL.createObjectURL(file);
      const img = await this.decode(url);

      // Cap the raster: a 4000px logo tells us nothing four corners do not, and
      // allocating it costs real memory on a phone.
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;

      ctx.drawImage(img, 0, 0, size, size);

      // Two pixels in, not zero: antialiasing at the very edge of a scaled draw
      // can leave a softened pixel that is not the background's true colour.
      const corners = [
        ctx.getImageData(2, 2, 1, 1).data,
        ctx.getImageData(size - 3, 2, 1, 1).data,
        ctx.getImageData(2, size - 3, 1, 1).data,
        ctx.getImageData(size - 3, size - 3, 1, 1).data,
      ];

      if (corners.some(c => c[3] < 250)) return null; // transparent somewhere: fine

      const [r, g, b] = corners[0];
      const sameEverywhere = corners.every(
        c => Math.abs(c[0] - r) < 12 && Math.abs(c[1] - g) < 12 && Math.abs(c[2] - b) < 12,
      );
      if (!sameEverywhere) return null;

      return `rgb(${r}, ${g}, ${b})`;
    } catch {
      // Could not decode it. Say nothing rather than blocking an upload on a
      // check that did not run.
      return null;
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  /**
   * Turn a logo on a solid backdrop into one that sits on the tile properly.
   *
   * WHY THIS IS IN THE APP AND NOT IN A NOTE TELLING SOMEONE TO USE PHOTOSHOP
   *
   * Because the note did not work. The uploaded file already IS the correct
   * logo; what is wrong with it is mechanical — a backdrop and a wide empty
   * margin — and both are the kind of thing a computer should do rather than
   * a person. Asking an admin to find an image editor, or to hunt for a
   * differently-prepared copy of a logo they already have, is asking them to do
   * a conversion by hand every time.
   *
   * TWO STEPS
   *
   * 1. Flood-fill from the four corners, clearing pixels within `tolerance` of
   *    the corner colour. Flood-fill, NOT "replace every pixel of this colour":
   *    a mark with white inside it — a counter, a highlight, the gap in a
   *    letter — must keep that white. Only the region actually connected to the
   *    edge is a background.
   *
   * 2. Trim the fully transparent margin. The tile uses object-fit: contain, so
   *    it fits the whole canvas — a mark centred in a wide frame renders at a
   *    fraction of the size of the logos beside it, which is the second half of
   *    why the uploaded render looked wrong.
   *
   * Returns null when there was nothing to do, so the caller uploads the
   * original file untouched rather than a re-encoded copy of it.
   */
  async cleanUp(file: File, tolerance = 32): Promise<File | null> {
    let url: string | null = null;
    try {
      url = URL.createObjectURL(file);
      const img = await this.decode(url);

      // Rasterise at the natural size, bounded. An SVG reports 0 for natural
      // dimensions in some browsers, so fall back to a size that is generous
      // for a tile rendered at 72px.
      const w = Math.min(img.naturalWidth || 512, 1024);
      const h = Math.min(img.naturalHeight || 512, 1024);
      if (!w || !h) return null;

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);

      const image = ctx.getImageData(0, 0, w, h);
      const cleared = this.clearBackground(image, w, h, tolerance);
      const bounds = this.opaqueBounds(image, w, h);

      // Nothing connected to the edge matched, and the artwork already fills the
      // frame: the file is fine as it is.
      if (!cleared && bounds.full) return null;
      if (!bounds.any) return null; // everything was cleared — refuse to ship an empty tile

      ctx.putImageData(image, 0, 0);

      // A little breathing room, so the mark does not touch the tile's edge.
      const pad = Math.round(Math.max(bounds.width, bounds.height) * 0.04);
      const out = document.createElement('canvas');
      out.width = bounds.width + pad * 2;
      out.height = bounds.height + pad * 2;
      const outCtx = out.getContext('2d');
      if (!outCtx) return null;
      outCtx.drawImage(
        canvas,
        bounds.x, bounds.y, bounds.width, bounds.height,
        pad, pad, bounds.width, bounds.height,
      );

      const blob: Blob | null = await new Promise(r => out.toBlob(r, 'image/png'));
      if (!blob) return null;

      const base = file.name.replace(/\.[^.]+$/, '');
      return new File([blob], `${base}.png`, { type: 'image/png' });
    } catch {
      return null;
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  /**
   * Clear the background region, in place. Returns whether anything changed.
   *
   * An explicit stack rather than recursion: a 1024x1024 background is a
   * million pixels, and a recursive fill blows the call stack long before it
   * finishes.
   */
  private clearBackground(
    image: ImageData, w: number, h: number, tolerance: number,
  ): boolean {
    const d = image.data;
    const at = (x: number, y: number) => (y * w + x) * 4;

    // Every corner seeds the fill. A logo can sit on a backdrop that is not
    // uniform across the whole image — a subtle vignette, for instance — and
    // seeding from one corner would leave the opposite side behind.
    const seeds: number[] = [];
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
      const i = at(x, y);
      if (d[i + 3] > 250) seeds.push(i);
    }
    if (!seeds.length) return false; // already transparent at the edges

    const [sr, sg, sb] = [d[seeds[0]], d[seeds[0] + 1], d[seeds[0] + 2]];

    const seen = new Uint8Array(w * h);
    const stack: number[] = [];
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
      stack.push(y * w + x);
    }

    let changed = false;
    while (stack.length) {
      const p = stack.pop()!;
      if (seen[p]) continue;
      seen[p] = 1;

      const i = p * 4;
      if (d[i + 3] < 8) continue; // already clear
      if (
        Math.abs(d[i] - sr) > tolerance ||
        Math.abs(d[i + 1] - sg) > tolerance ||
        Math.abs(d[i + 2] - sb) > tolerance
      ) {
        continue; // reached the artwork
      }

      d[i + 3] = 0;
      changed = true;

      const x = p % w;
      const y = (p - x) / w;
      if (x > 0) stack.push(p - 1);
      if (x < w - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - w);
      if (y < h - 1) stack.push(p + w);
    }
    return changed;
  }

  /** The box containing everything not fully transparent. */
  private opaqueBounds(image: ImageData, w: number, h: number) {
    const d = image.data;
    let minX = w, minY = h, maxX = -1, maxY = -1;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < 0) return { any: false, full: false, x: 0, y: 0, width: 0, height: 0 };

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    return {
      any: true,
      // Already tight, within a pixel or two either side.
      full: minX <= 1 && minY <= 1 && maxX >= w - 2 && maxY >= h - 2,
      x: minX, y: minY, width, height,
    };
  }

  private decode(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('could not decode'));
      img.src = url;
    });
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
