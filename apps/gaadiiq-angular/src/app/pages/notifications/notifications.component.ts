import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../services/auth.service';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  listing_id: string | null;
  is_read: boolean;
  created_at: string;
}

const TYPE_ICONS: Record<string, string> = {
  booking_received: '🚗',
  booking_confirmed: '✅',
  booking_cancelled: '❌',
  loan_inquiry_received: '💰',
  price_drop: '📉',
  listing_viewed: '👁',
  system: '🔔',
};

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notifications.component.html',
  styleUrl: './notifications.component.scss',
})
export class NotificationsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  notifications = signal<Notification[]>([]);
  loading = signal(true);

  unread = computed(() => this.notifications().filter((n) => !n.is_read).length);

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      void this.router.navigate(['/login']);
      return;
    }
    this.load();
  }

  /** authInterceptor attaches the Supabase bearer token to apiUrl requests. */
  private load(): void {
    this.loading.set(true);
    this.http
      .get<Notification[]>(`${environment.apiUrl}/notifications`, { params: { limit: 50 } })
      .subscribe({
        next: (rows) => {
          this.notifications.set(rows ?? []);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  icon(type: string): string {
    return TYPE_ICONS[type] ?? '🔔';
  }

  markRead(n: Notification): void {
    if (n.is_read) return;
    // Update locally first so the row responds immediately; a failed PATCH only
    // means the badge reappears on the next load, which is the harmless
    // direction to be wrong in.
    this.notifications.update((rows) =>
      rows.map((r) => (r.id === n.id ? { ...r, is_read: true } : r)),
    );
    this.http.patch(`${environment.apiUrl}/notifications/${n.id}/read`, {}).subscribe({
      error: () => this.load(),
    });
  }

  markAllRead(): void {
    if (this.unread() === 0) return;
    this.notifications.update((rows) => rows.map((r) => ({ ...r, is_read: true })));
    this.http.post(`${environment.apiUrl}/notifications/mark-all-read`, {}).subscribe({
      error: () => this.load(),
    });
  }
}
