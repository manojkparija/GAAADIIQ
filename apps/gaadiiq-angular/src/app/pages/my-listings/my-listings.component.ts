import { Component, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MyListingsService, MyListing } from '../../services/my-listings.service';
import { CarsDataService } from '../../services/cars-data.service';

@Component({
  selector: 'app-my-listings',
  standalone: true,
  imports: [RouterLink, CommonModule, FormsModule],
  templateUrl: './my-listings.component.html',
  styleUrl: './my-listings.component.scss'
})
export class MyListingsComponent {
  editingId = signal<string | null>(null);
  editPrice = signal<number>(0);
  saving = signal(false);

  constructor(public myListings: MyListingsService, private carsData: CarsDataService) {
    myListings.reload();
  }

  formatPrice(p: number) {
    return p >= 10000000 ? `₹${(p / 10000000).toFixed(1)} Cr`
      : p >= 100000 ? `₹${(p / 100000).toFixed(1)}L`
      : `₹${p.toLocaleString('en-IN')}`;
  }

  remove(id: string) {
    if (confirm('Remove this listing?')) this.myListings.remove(id);
  }

  startEdit(car: MyListing) {
    this.editingId.set(car.id);
    this.editPrice.set(car.price);
  }

  cancelEdit() { this.editingId.set(null); }

  async savePrice(id: string) {
    const price = this.editPrice();
    if (!price || price < 10000) return;
    this.saving.set(true);
    await this.myListings.updatePrice(id, price);
    this.saving.set(false);
    this.editingId.set(null);
  }

  // Market comparison: compare this car's price vs avg of same make/model in DB
  marketVerdict(car: MyListing): { label: string; cls: string; pct: number } | null {
    const all = this.carsData.cars().filter(
      c => c.make === car.make && c.model === car.model && !c.isSellerListing
    );
    if (all.length === 0) return null;
    const avg = all.reduce((s, c) => s + c.price, 0) / all.length;
    const pct = Math.round(((car.price - avg) / avg) * 100);
    if (pct < -5) return { label: `${Math.abs(pct)}% below market`, cls: 'verdict-low', pct };
    if (pct > 5)  return { label: `${pct}% above market`, cls: 'verdict-high', pct };
    return { label: 'At market price', cls: 'verdict-fair', pct };
  }

  marketAvg(car: MyListing): number | null {
    const all = this.carsData.cars().filter(
      c => c.make === car.make && c.model === car.model && !c.isSellerListing
    );
    if (all.length === 0) return null;
    return Math.round(all.reduce((s, c) => s + c.price, 0) / all.length);
  }

  statusLabel(s: MyListing['status']) {
    return s === 'pending' ? '⏳ Pending' : s === 'live' ? '✅ Live' : '🏷️ Sold';
  }

  statusClass(s: MyListing['status']) {
    return s === 'pending' ? 'badge-gold' : s === 'live' ? 'badge-green' : 'badge-purple';
  }
}
