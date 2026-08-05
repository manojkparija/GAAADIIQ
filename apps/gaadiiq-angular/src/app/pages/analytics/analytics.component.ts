import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';

interface ListingAnalytics {
  listing_id: string;
  title: string;
  price: number;
  views: number;
  bookings: number;
  loan_inquiries: number;
  reviews: number;
  avg_rating: number | null;
  is_active: boolean;
}

interface SellerAnalytics {
  total_listings: number;
  active_listings: number;
  total_views: number;
  total_bookings: number;
  total_loan_inquiries: number;
  total_reviews: number;
  overall_avg_rating: number | null;
  listings: ListingAnalytics[];
}

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.scss',
})
export class AnalyticsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  data = signal<SellerAnalytics | null>(null);
  loading = signal(true);
  failed = signal(false);

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigate(['/login']);
      return;
    }

    this.http.get<SellerAnalytics>(`${environment.apiUrl}/dealers/me/analytics`).subscribe({
      next: (res) => {
        this.data.set(res);
        this.loading.set(false);
      },
      error: () => {
        this.failed.set(true);
        this.loading.set(false);
      },
    });
  }

  formatINR(n: number): string {
    if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}L`;
    if (n >= 1_000) return `₹${(n / 1_000).toFixed(0)}K`;
    return `₹${n}`;
  }

  /** Filled-star count for a rating, for the compact star display. */
  stars(rating: number): boolean[] {
    return Array.from({ length: 5 }, (_, i) => i < Math.round(rating));
  }
}
