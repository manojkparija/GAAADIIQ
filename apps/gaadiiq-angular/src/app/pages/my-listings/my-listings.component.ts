import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MyListingsService, MyListing } from '../../services/my-listings.service';

@Component({
  selector: 'app-my-listings',
  standalone: true,
  imports: [RouterLink, CommonModule],
  templateUrl: './my-listings.component.html',
  styleUrl: './my-listings.component.scss'
})
export class MyListingsComponent {
  constructor(public myListings: MyListingsService) {
    // Ensure listings are loaded for the currently logged-in user
    myListings.reload();
  }

  formatPrice(p: number) { return p >= 100000 ? `₹${(p / 100000).toFixed(1)}L` : `₹${p.toLocaleString()}`; }

  remove(id: string) {
    if (confirm('Remove this listing?')) this.myListings.remove(id);
  }

  statusLabel(s: MyListing['status']) {
    return s === 'pending' ? '⏳ Pending Review' : s === 'live' ? '✅ Live' : '🏷️ Sold';
  }

  statusClass(s: MyListing['status']) {
    return s === 'pending' ? 'badge-gold' : s === 'live' ? 'badge-green' : 'badge-purple';
  }
}
