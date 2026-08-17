import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { DemandMap, DemandService, DaysTurn, InventoryGapReport } from '../../services/demand.service';
import { Insight, listingInsights } from '../../utils/listing-insights';
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
  private readonly demandSvc = inject(DemandService);

  data = signal<SellerAnalytics | null>(null);

  /** The platform's observed median time-to-sell, when it has one. */
  daysTurn = signal<DaysTurn | null>(null);

  /**
   * Where buyers are searching, and what they searched for and did not find.
   *
   * Both can come back saying they have no answer yet — a marketplace with
   * eleven searches cannot tell a dealer where demand is, and a heatmap drawn
   * from eleven searches is decoration that someone will buy stock against.
   */
  demandMap = signal<DemandMap | null>(null);
  gaps = signal<InventoryGapReport | null>(null);
  loading = signal(true);
  failed = signal(false);

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigate(['/login']);
      return;
    }

    void this.demandSvc.daysTurn().then(t => this.daysTurn.set(t));
    void this.demandSvc.map().then(m => this.demandMap.set(m));
    void this.demandSvc.inventoryGaps().then(g => this.gaps.set(g));

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

  /**
   * What each listing's numbers mean, in words.
   *
   * Cached by listing id: this is called from the template, so without it the
   * insights recompute on every change-detection cycle for every row.
   */
  private _insightCache = new Map<string, Insight[]>();

  insightsFor(l: any): Insight[] {
    const cached = this._insightCache.get(l.listing_id);
    if (cached) return cached;

    const t = this.daysTurn();
    const built = listingInsights({
      title: l.title,
      price: l.price,
      views: l.views,
      bookings: l.bookings,
      loanInquiries: l.loan_inquiries,
      medianDaysToSell: t?.has_enough_data ? t.median_days : null,
    });
    this._insightCache.set(l.listing_id, built);
    return built;
  }
}
