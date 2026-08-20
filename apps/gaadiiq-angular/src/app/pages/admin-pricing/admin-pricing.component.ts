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

/**
 * What the API says about a price against the recorded reference.
 *
 * `has_reference` is separate from `is_significant` deliberately: a model with
 * nothing to compare against is not the same as one that was compared and
 * found fine, and an admin about to publish should be able to tell them apart.
 */
interface PriceCheck {
  has_reference: boolean;
  is_significant: boolean;
  difference: number | null;
  reference_age_days: number | null;
  is_stale: boolean;
  message: string | null;
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

  /**
   * The reference check, once a price has been checked against it.
   *
   * Held per row rather than globally so two rows being edited cannot show
   * each other's warning. Null means not checked yet — distinct from checked
   * and clean, which is a PriceCheck with is_significant false.
   */
  priceCheck?: PriceCheck | null;
  /** Set when the admin has seen the warning and chosen to publish anyway. */
  overrideWarning?: boolean;
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

  /** Ask the API how this price compares with the recorded reference. */
  private async checkAgainstReference(row: PriceRow, value: number): Promise<PriceCheck | null> {
    try {
      return await firstValueFrom(
        this.http.get<PriceCheck>(`${this.apiUrl}/cars/${row.id}/price-check`, {
          params: { price: String(value) },
        })
      );
    } catch {
      // A check that cannot run must not block a save. Returning null leaves
      // the price editable rather than trapping the admin behind a warning
      // the server could not produce.
      return null;
    }
  }

  /** Drop the warning and go back to editing, rather than publishing. */
  dismissPriceCheck(row: PriceRow) {
    row.priceCheck = null;
    row.overrideWarning = false;
  }

  /**
   * Save a price, checking it against the reference first.
   *
   * The warning interrupts once and does not block: an admin who knows the
   * reference is stale must still be able to publish, and a warning that
   * cannot be passed is one people learn to route around. Pressing save again
   * goes through.
   */
  async savePrice(row: PriceRow) {
    const value = row.editPrice;
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      row.error = 'Enter a price of ₹0 or more, or clear the field.';
      return;
    }

    // Clearing a price is not a price to check.
    if (value != null && !row.overrideWarning) {
      const check = await this.checkAgainstReference(row, value);
      if (check?.is_significant) {
        row.priceCheck = check;
        row.overrideWarning = true;   // the next press publishes
        return;
      }
      row.priceCheck = check;
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
      row.overrideWarning = false;
      row.priceCheck = null;
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
