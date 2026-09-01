import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../components/icon/icon.component';
import {
  CarLoanService,
  LoanApplicationAdmin,
  LoanApplicationStatus,
} from '../../services/car-loan.service';

type Tab = 'all' | 'partner_selected' | 'submitted';

/**
 * The loan application queue, and the only way anyone hears back.
 *
 * Pressing "Continue with <bank>" writes `selected_offer_id` and sets the
 * status to `partner_selected`. That is the entire effect: no application is
 * forwarded to the lender, no email is sent, nothing is exported. The bank
 * never learns the application exists.
 *
 * `GET /loans/admin/applications` has existed since the feature was built, but
 * nothing in the app called it and it did not return an email or a city — so
 * an applicant's details were reachable only by querying Postgres by hand.
 * Until a lender hand-off exists, working this queue by phone is how an
 * applicant is contacted at all, which is why the phone number and the email
 * are the two things this screen makes impossible to miss.
 *
 * The PAN stays masked, as it is everywhere else. An admin who needs the full
 * number for a lender hand-off should get it from that hand-off, not from a
 * list that would put every applicant's PAN on one screen.
 */
@Component({
  selector: 'app-admin-loans',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: './admin-loans.component.html',
  styleUrls: ['./admin-loans.component.scss'],
})
export class AdminLoansComponent {
  private readonly loans = inject(CarLoanService);

  readonly applications = signal<LoanApplicationAdmin[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly tab = signal<Tab>('all');

  /** Free-text over name, phone, email, city, pincode and reference. */
  search = '';

  readonly TABS: { key: Tab; label: string }[] = [
    { key: 'all', label: 'All applications' },
    { key: 'partner_selected', label: 'Lender chosen' },
    { key: 'submitted', label: 'No lender yet' },
  ];

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const filter = this.tab() === 'all' ? undefined : (this.tab() as LoanApplicationStatus);
      this.applications.set(await this.loans.adminApplications(filter));
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      this.error.set(
        status === 401 || status === 403
          ? 'This queue is admin-only. Sign in with an admin account.'
          : 'Could not load the applications. Please try again.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  selectTab(tab: Tab): void {
    this.tab.set(tab);
    void this.load();
  }

  /**
   * A method, not a computed().
   *
   * `search` is a plain field bound with ngModel, and computed() tracks signal
   * reads only — over a plain field it evaluates once and then reports a stale
   * answer forever. That has shipped here twice.
   */
  visible(): LoanApplicationAdmin[] {
    const q = this.search.trim().toLowerCase();
    if (!q) return this.applications();
    return this.applications().filter(a =>
      [a.applicant_name, a.mobile, a.email, a.city, a.pincode, a.reference]
        .some(field => (field ?? '').toLowerCase().includes(q)),
    );
  }

  money(value: number | null | undefined): string {
    return this.loans.formatRupees(value);
  }

  telHref(phone: string): string {
    return `tel:${phone.replace(/[^0-9+]/g, '')}`;
  }

  /** WhatsApp needs a country code; Indian mobiles are stored without one. */
  waHref(phone: string): string {
    const digits = phone.replace(/[^0-9]/g, '');
    const withCode = digits.length === 10 ? `91${digits}` : digits;
    return `https://wa.me/${withCode}`;
  }

  mailHref(app: LoanApplicationAdmin): string {
    const subject = `GAADIIQ car loan application ${app.reference}`;
    return `mailto:${app.email}?subject=${encodeURIComponent(subject)}`;
  }

  /**
   * `self_employed` is a database value, not something to show a person.
   *
   * The three keys are the whole of models.lending_partner.EmploymentType; an
   * unknown value falls through to itself rather than to a wrong guess.
   */
  employmentLabel(employment: string): string {
    const labels: Record<string, string> = {
      salaried: 'Salaried',
      self_employed: 'Self-employed',
      business: 'Business owner',
    };
    return labels[employment] ?? employment;
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Draft',
      submitted: 'No lender chosen',
      offers_ready: 'Offers ready',
      partner_selected: 'Lender chosen',
      forwarded: 'Sent to lender',
      approved: 'Approved',
      rejected: 'Rejected',
      withdrawn: 'Withdrawn',
      disbursed: 'Disbursed',
    };
    return labels[status] ?? status;
  }
}
