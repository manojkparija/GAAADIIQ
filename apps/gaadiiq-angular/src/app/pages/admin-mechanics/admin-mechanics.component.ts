import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../components/icon/icon.component';
import { SupabaseService } from '../../services/supabase.service';
import { environment } from '../../../environments/environment';

/** A mechanic as the admin listing returns them. */
export interface AdminMechanic {
  id: string;
  full_name: string;
  shop_name: string | null;
  phone: string;
  whatsapp_phone: string | null;
  email: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  state: string;
  area_pincode: string;
  service_radius_km: number;
  pan_number: string;
  aadhaar_masked: string;
  upi_vpa: string | null;
  specialisations: string[] | null;
  status: 'pending_verification' | 'active' | 'rejected' | 'suspended';
  is_available: boolean;
  rating: number | null;
  jobs_completed: number;
  created_at: string;
}

type Tab = 'pending_verification' | 'active' | 'rejected';

/**
 * The mechanic verification queue.
 *
 * Registration deliberately only ever writes a `pending_verification` row, and
 * only `active` mechanics are matchable or can be dispatched a job. The API
 * has had both halves of that gate since the registry was built —
 * `GET /mechanics?status=…` and `PATCH /mechanics/{id}/verify` — but no screen
 * ever called them, so a mechanic who registered stayed pending forever and an
 * admin was told to wait for a verification that nothing could perform.
 *
 * The KYC fields are the reason this is a screen and not a button: approving
 * means asserting somebody checked the PAN and the Aadhaar fragment against
 * the person. So they are shown, and rejection takes a reason.
 */
@Component({
  selector: 'app-admin-mechanics',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent],
  templateUrl: './admin-mechanics.component.html',
  styleUrls: ['./admin-mechanics.component.scss'],
})
export class AdminMechanicsComponent {
  private supabase = inject(SupabaseService);
  private apiUrl = environment.apiUrl;

  tab = signal<Tab>('pending_verification');
  mechanics = signal<AdminMechanic[]>([]);
  loading = signal(false);
  error = signal('');
  toastMsg = signal('');

  /** Free-text filter over name, shop, phone and pincode. */
  search = signal('');

  /** Which row is mid-decision, so its buttons can be disabled. */
  busyId = signal<string | null>(null);

  /** The row being rejected, and the reason being typed for it. */
  rejectingId = signal<string | null>(null);
  rejectReason = '';

  readonly TABS: { key: Tab; label: string }[] = [
    { key: 'pending_verification', label: 'Awaiting verification' },
    { key: 'active', label: 'Approved' },
    { key: 'rejected', label: 'Rejected' },
  ];

  visible = computed(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return this.mechanics();
    return this.mechanics().filter(m =>
      [m.full_name, m.shop_name, m.phone, m.whatsapp_phone, m.area_pincode, m.city]
        .some(field => (field ?? '').toLowerCase().includes(q)),
    );
  });

  constructor() {
    void this.load();
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const { data } = await this.supabase.client.auth.getSession();
    const token = data.session?.access_token ?? '';
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private toast(msg: string) {
    this.toastMsg.set(msg);
    setTimeout(() => this.toastMsg.set(''), 4000);
  }

  selectTab(tab: Tab) {
    this.tab.set(tab);
    this.rejectingId.set(null);
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const resp = await fetch(
        `${this.apiUrl}/mechanics?status=${this.tab()}&limit=200`,
        { headers: await this.authHeaders() },
      );
      if (!resp.ok) {
        // Say which failure it was. "Could not load" sends an admin looking
        // for a bug when the real answer is that they are not an admin.
        this.error.set(
          resp.status === 401 || resp.status === 403
            ? 'This page is for admin accounts. Sign in as an admin and reload.'
            : `Could not load mechanics (HTTP ${resp.status}).`,
        );
        this.mechanics.set([]);
        return;
      }
      this.mechanics.set(await resp.json());
    } catch {
      this.error.set('Could not reach the API. Check your connection and reload.');
      this.mechanics.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  async approve(m: AdminMechanic) {
    await this._decide(m, true, null);
  }

  startReject(m: AdminMechanic) {
    this.rejectingId.set(m.id);
    this.rejectReason = '';
  }

  cancelReject() {
    this.rejectingId.set(null);
    this.rejectReason = '';
  }

  async confirmReject(m: AdminMechanic) {
    const reason = this.rejectReason.trim();
    if (!reason) return;   // the button is disabled too; this is the guard
    await this._decide(m, false, reason);
  }

  private async _decide(m: AdminMechanic, approve: boolean, reason: string | null) {
    this.busyId.set(m.id);
    try {
      const resp = await fetch(`${this.apiUrl}/mechanics/${m.id}/verify`, {
        method: 'PATCH',
        headers: { ...(await this.authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve, reason }),
      });
      if (!resp.ok) {
        this.toast(`Could not save the decision (HTTP ${resp.status}).`);
        return;
      }
      // Drop the row from the tab it no longer belongs to, rather than
      // reloading — the decision is what the admin just watched happen.
      this.mechanics.set(this.mechanics().filter(x => x.id !== m.id));
      this.rejectingId.set(null);
      this.toast(
        approve
          ? `${m.full_name} approved — they can now be dispatched jobs.`
          : `${m.full_name} rejected.`,
      );
    } catch {
      this.toast('Could not reach the API. The decision was not saved.');
    } finally {
      this.busyId.set(null);
    }
  }

  /** Human label for a status, used on the non-pending tabs. */
  statusLabel(s: AdminMechanic['status']): string {
    return {
      pending_verification: 'Awaiting verification',
      active: 'Approved',
      rejected: 'Rejected',
      suspended: 'Suspended',
    }[s] ?? s;
  }

  registeredOn(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  }
}
