/**
 * The seller/dealer analytics page.
 *
 * Two things are being checked. That the demand panels render what the API
 * returns — and, more importantly, that they render the *refusal* when the API
 * says it has no answer yet. A heatmap drawn from eleven searches is
 * decoration, and a dealer will buy stock against it.
 */

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AnalyticsComponent } from './analytics.component';
import { AuthService } from '../../services/auth.service';
import { DemandService } from '../../services/demand.service';
import { environment } from '../../../environments/environment';

const ANALYTICS = {
  total_listings: 2, active_listings: 2, total_views: 438, total_bookings: 1,
  total_loan_inquiries: 0, total_reviews: 0, overall_avg_rating: null,
  listings: [
    // Seen a lot, contacted by nobody — the state the bare numbers hid.
    { listing_id: 'L1', title: '2020 Swift VXi', price: 550000, views: 380,
      bookings: 0, loan_inquiries: 0, reviews: 0, avg_rating: null, is_active: true },
    // Barely seen — nothing can be concluded from it.
    { listing_id: 'L2', title: '2021 Creta SX', price: 1150000, views: 4,
      bookings: 0, loan_inquiries: 0, reviews: 0, avg_rating: null, is_active: true },
  ],
};

function setup(demand: Partial<Record<string, unknown>>) {
  TestBed.configureTestingModule({
    imports: [AnalyticsComponent],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { isLoggedIn: () => true } },
      {
        provide: DemandService,
        useValue: {
          daysTurn: () => Promise.resolve(demand['daysTurn'] ?? null),
          map: () => Promise.resolve(demand['map'] ?? null),
          inventoryGaps: () => Promise.resolve(demand['gaps'] ?? null),
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(AnalyticsComponent);
  fixture.detectChanges();

  const http = TestBed.inject(HttpTestingController);
  http.expectOne(`${environment.apiUrl}/dealers/me/analytics`).flush(ANALYTICS);
  fixture.detectChanges();
  return fixture;
}

describe('AnalyticsComponent demand panels', () => {
  it('prints the note instead of a number when the data is too thin', async () => {
    const fixture = setup({
      daysTurn: { median_days: null, sample_size: 3, has_enough_data: false,
                  note: 'Only 3 closed listings so far', basis: '' },
      map: { cells: [], window_days: 30, total_searches: 4, has_enough_data: false,
             note: '4 searches recorded in the last 30 days' },
      gaps: { gaps: [], window_days: 30, has_enough_data: false,
              note: '2 model-specific searches in the last 30 days' },
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Only 3 closed listings');
    expect(text).toContain('4 searches recorded');
    // The refusal must not be dressed up as a measurement of zero.
    expect(fixture.nativeElement.querySelector('.demand-figure')).toBeNull();
  });

  it('shows the figures once the API says they are supported', async () => {
    const fixture = setup({
      daysTurn: { median_days: 34, sample_size: 41, has_enough_data: true,
                  note: null, basis: 'Median days between listing and closing.' },
      map: { cells: [{ city: 'Kolkata', searches: 182, empty_searches: 63 }],
             window_days: 30, total_searches: 182, has_enough_data: true, note: null },
      gaps: { gaps: [{ make: 'Toyota', model: 'Fortuner', searches: 61,
                       empty_searches: 61, listings_available: 0 }],
              window_days: 30, has_enough_data: true, note: null },
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('34');
    expect(text).toContain('Kolkata');
    expect(text).toContain('Fortuner');
    // Unmet demand is the half a dealer buys stock against.
    expect(text).toContain('63 found nothing');
  });

  it('survives the demand API being unreachable', async () => {
    // Null is "we do not know", which must not take the rest of the page down.
    const fixture = setup({ daysTurn: null, map: null, gaps: null });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Not available right now');
    expect(fixture.nativeElement.textContent).toContain('Per-Listing Breakdown');
  });

  it('explains each listing instead of leaving four bare numbers', async () => {
    const fixture = setup({ daysTurn: null, map: null, gaps: null });
    await fixture.whenStable();
    fixture.detectChanges();

    const insights = fixture.nativeElement.querySelectorAll('.insight');
    expect(insights.length).toBeGreaterThan(0);

    const all = Array.from(insights).map((e: any) => e.textContent).join(' ');
    // The well-seen listing with no enquiries gets advice…
    expect(all).toMatch(/price|photograph/i);
    // …and the barely-seen one is told it simply has not been seen.
    expect(all).toContain('has not been seen');
  });
});
