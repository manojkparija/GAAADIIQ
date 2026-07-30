import { Injectable, signal } from '@angular/core';
import { BrochureService } from './brochure.service';

/**
 * Resolves the best brochure photograph for a vehicle, for surfaces that have
 * a car but no picture of it.
 *
 * The catalogue has always had a placeholder for cars whose own `image` field
 * is empty, which is most of them — a listing carries the seller's photos, and
 * a model in the catalogue often carries none. Brochure ingestion produces
 * exactly the missing pictures, so this closes the loop: one uploaded PDF
 * supplies imagery to every card, comparison row and model page for that
 * vehicle, rather than each surface keeping its own copy.
 *
 * Templates need a synchronous answer, so lookups are fired once per vehicle
 * and the result is held in a signal. A card renders its placeholder on the
 * first pass and the real photograph when the signal updates, which is the
 * same behaviour as an image that simply loads late.
 */
@Injectable({ providedIn: 'root' })
export class VehicleImageService {
  /** "make|model|variant" → resolved URL, or null once a lookup found nothing. */
  private readonly resolved = signal<Record<string, string | null>>({});

  /** Guards against a grid of twenty cards firing twenty identical requests. */
  private readonly inFlight = new Set<string>();

  constructor(private brochures: BrochureService) {}

  private key(make?: string | null, model?: string | null, variant?: string | null): string {
    return `${make ?? ''}|${model ?? ''}|${variant ?? ''}`.toLowerCase();
  }

  /**
   * The URL for a vehicle if one is already known, otherwise null — and starts
   * a lookup so a later render has it.
   *
   * Safe to call from a template on every change-detection pass: repeated calls
   * for the same vehicle neither refetch nor queue duplicate work.
   */
  urlFor(make?: string | null, model?: string | null, variant?: string | null): string | null {
    if (!make || !model) return null;

    const key = this.key(make, model, variant);
    const known = this.resolved()[key];
    if (known !== undefined) return known;

    if (!this.inFlight.has(key)) {
      this.inFlight.add(key);
      // Fire and forget: a failure resolves to null and the caller keeps its
      // placeholder, which is exactly the behaviour before this existed.
      this.brochures
        .heroImage(make, model, variant ?? undefined)
        .then(image => {
          // Thumbnails are what cards and comparison rows want; the full-size
          // press shot is for a detail view.
          const url = image ? (image.thumbnail_url || image.url) : null;
          this.resolved.update(m => ({ ...m, [key]: url }));
        })
        .catch(() => this.resolved.update(m => ({ ...m, [key]: null })))
        .finally(() => this.inFlight.delete(key));
    }

    return null;
  }

  /**
   * A vehicle's own image when it has one, else a brochure photograph, else the
   * placeholder — the order every surface wants.
   */
  imageOr(
    own: string | null | undefined,
    make?: string | null,
    model?: string | null,
    variant?: string | null,
    placeholder = 'assets/cars/placeholder.svg',
  ): string {
    if (own) return own;
    return this.urlFor(make, model, variant) ?? placeholder;
  }
}
