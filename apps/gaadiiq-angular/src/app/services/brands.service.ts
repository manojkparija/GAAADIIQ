import { Injectable, signal, computed } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { BRANDS, Brand } from '../data/brands';

@Injectable({ providedIn: 'root' })
export class BrandsService {
  private _brands = signal<Brand[]>(BRANDS);  // start with local fallback
  private _loaded = signal(false);

  brands = computed(() => this._brands());
  loaded = computed(() => this._loaded());

  constructor(private sb: SupabaseService) {
    this.load();
  }

  /**
   * Re-read the table.
   *
   * The brand list is fetched once at construction and this service is a
   * root singleton, so without this an admin who uploads a logo keeps seeing
   * the old grid until a full page reload — and reasonably concludes the
   * upload did not work.
   */
  reload(): Promise<void> {
    return this.load();
  }

  private async load() {
    try {
      const { data, error } = await this.sb.client
        .from('brands')
        .select('name, slug, logo_url, country')
        .eq('active', true)
        .order('sort_order');

      if (!error && data && data.length > 0) {
        this._brands.set(
          data.map(r => ({
            name: r.name,
            slug: r.slug,
            logo: r.logo_url ?? `assets/brand-logos/${r.slug}.svg`,
            country: r.country ?? '',
          }))
        );
      }
    } catch {
      // keep local fallback on network error
    } finally {
      this._loaded.set(true);
    }
  }
}
