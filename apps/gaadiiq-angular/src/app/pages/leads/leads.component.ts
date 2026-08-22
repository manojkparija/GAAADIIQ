import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';
import { CustomSelectComponent } from '../../components/custom-select/custom-select.component';
import { TranslatePipe } from '../../pipes/translate.pipe';

type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed';

interface Booking {
  id: string;
  listing_id: string;
  user_id: string;
  preferred_date: string | null;
  preferred_time: string | null;
  status: BookingStatus;
  notes: string | null;
  created_at: string;
}

interface LoanInquiry {
  id: string;
  listing_id: string;
  loan_amount: number | null;
  tenure_months: number | null;
  employment_type: string | null;
  annual_income: number | null;
  status: string;
  created_at: string;
}

@Component({
  selector: 'app-leads',
  standalone: true,
  imports: [CommonModule, FormsModule, CustomSelectComponent, TranslatePipe],
  templateUrl: './leads.component.html',
  styleUrl: './leads.component.scss',
})
export class LeadsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly bookingStatuses: BookingStatus[] = ['pending', 'confirmed', 'completed', 'cancelled'];

  bookings = signal<Booking[]>([]);
  loanInquiries = signal<LoanInquiry[]>([]);
  loading = signal(true);

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigate(['/login']);
      return;
    }

    // Both lists are independent; a failure in one leaves the other usable
    // rather than blanking the page.
    this.http.get<Booking[]>(`${environment.apiUrl}/bookings/received`).subscribe({
      next: (rows) => this.bookings.set(rows ?? []),
      error: () => this.bookings.set([]),
      complete: () => this.loading.set(false),
    });

    this.http.get<LoanInquiry[]>(`${environment.apiUrl}/loans/inquiries/received`).subscribe({
      next: (rows) => this.loanInquiries.set(rows ?? []),
      error: () => this.loanInquiries.set([]),
    });
  }

  updateStatus(booking: Booking, next: BookingStatus): void {
    if (next === booking.status) return;
    const previous = booking.status;

    this.bookings.update((rows) =>
      rows.map((b) => (b.id === booking.id ? { ...b, status: next } : b)),
    );

    this.http
      .patch(`${environment.apiUrl}/bookings/${booking.id}/status`, { status: next })
      .subscribe({
        // Roll back on failure so the dropdown never shows a status the server
        // did not accept.
        error: () =>
          this.bookings.update((rows) =>
            rows.map((b) => (b.id === booking.id ? { ...b, status: previous } : b)),
          ),
      });
  }

  formatINR(n: number | null): string {
    if (n === null || n === undefined) return '—';
    if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}L`;
    return `₹${(n / 1_000).toFixed(0)}K`;
  }

  employment(value: string | null): string {
    return value ? value.replace(/_/g, ' ') : '—';
  }
}
