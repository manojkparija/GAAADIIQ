import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { CarsDataService } from '../../services/cars-data.service';
import { environment } from '../../../environments/environment';
import { CustomSelectComponent } from '../../components/custom-select/custom-select.component';

interface ApiCatalogueCar {
  id: string;
  make: string;
  model: string;
  variant: string | null;
  year: number;
  fuel_type: string | null;
  body_type: string | null;
  ex_showroom_price: string | null;
  image_urls: string[];
}

interface ApiCarListResponse {
  items: ApiCatalogueCar[];
  total: number;
  page: number;
  page_size: number;
}

interface PriceRow {
  id: string;
  make: string;
  model: string;
  variant: string | null;
  year: number;
  /** Rupees, or null when nobody has priced this model yet. */
  price: number | null;
  imageCount: number;
  editPrice: number | null;
  editing: boolean;
  saving: boolean;
  error: string;
}

/**
 * Ex-showroom prices for the new-car catalogue.
 *
 * This edits the manufacturer's published price for a model, which is what
 * every buyer sees on the New Cars pages — not a seller's asking price on a
 * particular advert. Those belong to the listing and are edited by whoever
 * owns it.
 *
 * A model with no price is left visible and marked as such rather than hidden:
 * the gaps are the point of this screen, since an unpriced model never reaches
 * the New Cars pages.
 */
@Component({
  selector: 'app-admin-pricing',
  standalone: true,
  imports: [CommonModule, FormsModule, CustomSelectComponent],
  templateUrl: './admin-pricing.component.html',
  styleUrl: './admin-pricing.component.scss'
})
export class AdminPricingComponent {
  private http = inject(HttpClient);
  private carsData = inject(CarsDataService);
  private apiUrl = environment.apiUrl;

  searchQ = signal('');
  filterMake = signal('All');
  onlyUnpriced = signal(false);
  savedMsg = signal('');
  loading = signal(true);
  loadError = signal('');

  private cars = signal<PriceRow[]>([]);

  constructor(auth: AuthService, router: Router) {
    if (!auth.isAdmin()) {
      router.navigate(['/']);
      return;
    }
    void this.load();
  }

  private async load() {
    this.loading.set(true);
    this.loadError.set('');
    try {
      // The whole catalogue, priced or not: an admin needs to see which models
      // are still missing a price, so priced_only is deliberately not set.
      const resp = await firstValueFrom(
        this.http.get<ApiCarListResponse>(`${this.apiUrl}/cars?page_size=100`)
      );
      this.cars.set((resp?.items ?? []).map(c => ({
        id: c.id,
        make: c.make,
        model: c.model,
        variant: c.variant,
        year: c.year,
        price: c.ex_showroom_price == null ? null : Number(c.ex_showroom_price),
        imageCount: (c.image_urls ?? []).length,
        editPrice: c.ex_showroom_price == null ? null : Number(c.ex_showroom_price),
        editing: false,
        saving: false,
        error: '',
      })));
    } catch (err) {
      this.loadError.set('Could not load the catalogue. Please retry.');
      console.error('Catalogue load failed:', err);
    } finally {
      this.loading.set(false);
    }
  }

  retry() { void this.load(); }

  makes = computed(() => ['All', ...new Set(this.cars().map(c => c.make))].sort());

  unpricedCount = computed(() => this.cars().filter(c => c.price == null).length);

  rows = computed<PriceRow[]>(() => {
    const q = this.searchQ().toLowerCase();
    const make = this.filterMake();
    const unpricedOnly = this.onlyUnpriced();

    return this.cars().filter(c => {
      if (make !== 'All' && c.make !== make) return false;
      if (unpricedOnly && c.price != null) return false;
      if (q && !`${c.make} ${c.model} ${c.variant ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  startEdit(row: PriceRow) {
    row.editing = true;
    row.editPrice = row.price;
    row.error = '';
  }

  cancelEdit(row: PriceRow) {
    row.editing = false;
    row.editPrice = row.price;
    row.error = '';
  }

  async savePrice(row: PriceRow) {
    const value = row.editPrice;
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      row.error = 'Enter a price of ₹0 or more, or clear the field.';
      return;
    }

    row.saving = true;
    row.error = '';
    try {
      // An empty field clears the price back to "price on request", which is
      // how a model is taken off the New Cars pages without deleting it.
      const body = { ex_showroom_price: value == null ? null : String(value) };
      const updated = await firstValueFrom(
        this.http.patch<ApiCatalogueCar>(`${this.apiUrl}/cars/${row.id}`, body)
      );

      row.price = updated.ex_showroom_price == null ? null : Number(updated.ex_showroom_price);
      row.editPrice = row.price;
      row.editing = false;
      this.savedMsg.set(
        row.price == null
          ? `✓ Price cleared for ${row.make} ${row.model} — now shown as price on request`
          : `✓ Price updated for ${row.make} ${row.model}`
      );
      setTimeout(() => this.savedMsg.set(''), 3000);
      this.carsData.reload();
    } catch (err) {
      row.error = 'Could not save that price. Please retry.';
      console.error('Price update failed:', err);
    } finally {
      row.saving = false;
    }
  }

  formatPrice(p: number | null) {
    if (p == null) return '—';
    return p >= 10000000 ? `₹${(p / 10000000).toFixed(2)} Cr`
      : p >= 100000 ? `₹${(p / 100000).toFixed(1)}L`
      : `₹${p.toLocaleString('en-IN')}`;
  }
}
