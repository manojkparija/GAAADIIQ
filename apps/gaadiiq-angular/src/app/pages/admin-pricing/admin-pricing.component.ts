import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CarsDataService, Car } from '../../services/cars-data.service';
import { SupabaseService } from '../../services/supabase.service';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';

interface PriceRow extends Car {
  editPrice: number;
  editing: boolean;
  saving: boolean;
  marketAvg: number | null;
  pctVsMarket: number | null;
}

@Component({
  selector: 'app-admin-pricing',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-pricing.component.html',
  styleUrl: './admin-pricing.component.scss'
})
export class AdminPricingComponent {
  searchQ = signal('');
  filterMake = signal('All');
  savedMsg = signal('');

  constructor(
    private carsData: CarsDataService,
    private sb: SupabaseService,
    private auth: AuthService,
    private router: Router
  ) {
    if (!auth.isAdmin()) router.navigate(['/']);
  }

  makes = computed(() => ['All', ...new Set(this.carsData.cars().map(c => c.make))].sort());

  rows = computed<PriceRow[]>(() => {
    const q = this.searchQ().toLowerCase();
    const make = this.filterMake();
    const cars = this.carsData.cars().filter(c => {
      if (make !== 'All' && c.make !== make) return false;
      if (q && !`${c.make} ${c.model} ${c.variant ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });

    // Build market avg per make+model from non-seller listings
    const avgMap = new Map<string, number>();
    const allCars = this.carsData.cars();
    const makeModels = [...new Set(allCars.map(c => `${c.make}|${c.model}`))];
    for (const key of makeModels) {
      const [m, mo] = key.split('|');
      const group = allCars.filter(c => c.make === m && c.model === mo && !c.isSellerListing);
      if (group.length > 0) avgMap.set(key, Math.round(group.reduce((s, c) => s + c.price, 0) / group.length));
    }

    return cars.map(c => {
      const avg = avgMap.get(`${c.make}|${c.model}`) ?? null;
      const pct = avg ? Math.round(((c.price - avg) / avg) * 100) : null;
      return { ...c, editPrice: c.price, editing: false, saving: false, marketAvg: avg, pctVsMarket: pct };
    });
  });

  startEdit(row: PriceRow) { row.editing = true; row.editPrice = row.price; }
  cancelEdit(row: PriceRow) { row.editing = false; }

  async savePrice(row: PriceRow) {
    if (!row.editPrice || row.editPrice < 1000) return;
    row.saving = true;
    const { error } = await this.sb.client.from('cars').update({ price: row.editPrice }).eq('id', row.id);
    if (!error) {
      row.price = row.editPrice;
      row.editing = false;
      this.savedMsg.set(`✓ Price updated for ${row.make} ${row.model}`);
      setTimeout(() => this.savedMsg.set(''), 3000);
      // Reload cars data to reflect change
      (this.carsData as any).load?.();
    }
    row.saving = false;
  }

  formatPrice(p: number) {
    return p >= 10000000 ? `₹${(p / 10000000).toFixed(2)} Cr`
      : p >= 100000 ? `₹${(p / 100000).toFixed(1)}L`
      : `₹${p.toLocaleString('en-IN')}`;
  }

  verdictClass(pct: number | null) {
    if (pct === null) return '';
    if (pct < -5) return 'v-low';
    if (pct > 5) return 'v-high';
    return 'v-fair';
  }

  verdictLabel(pct: number | null) {
    if (pct === null) return '—';
    if (pct < -5) return `↓ ${Math.abs(pct)}% below avg`;
    if (pct > 5) return `↑ ${pct}% above avg`;
    return '≈ At market';
  }
}
