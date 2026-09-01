import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/** A lender as the public rate table shows them. */
export interface LendingPartner {
  id: string;
  name: string;
  slug: string;
  partner_type: 'bank' | 'nbfc' | 'captive';
  logo_url: string | null;
  /** The best band's rate — what a bank's own marketing quotes as "from". */
  rate_from_pct: number | null;
  min_loan_amount: number;
  max_loan_amount: number;
  min_tenure_months: number;
  max_tenure_months: number;
  min_monthly_income: number;
  max_ltv_pct: number;
  processing_fee_pct: number;
  finances_used_cars: boolean;
}

export interface LoanOffer {
  id: string;
  partner: LendingPartner;
  is_eligible: boolean;
  /** Present when the lender cannot fund this application, in words for the user. */
  ineligible_reason: string | null;
  annual_rate_pct: number | null;
  /** May be below the amount asked for, when LTV or income caps bite. */
  approved_amount: number | null;
  tenure_months: number | null;
  monthly_emi: number | null;
  total_interest: number | null;
  processing_fee: number | null;
  /** Interest plus fees — what the credit costs, and what the ranking uses. */
  total_cost: number | null;
  rank: number | null;
  is_recommended: boolean;
}

export type CreditBand = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

export interface LoanApplication {
  id: string;
  reference: string;
  status: string;
  vehicle_condition: 'new' | 'used';
  vehicle_description: string | null;
  vehicle_price: number;
  applicant_name: string;
  mobile: string;
  /** Always masked — the API never returns the full PAN. */
  pan_masked: string;
  employment_type: string;
  monthly_income: number;
  existing_emi: number;
  down_payment: number;
  loan_amount: number;
  tenure_months: number;
  credit_score: number | null;
  credit_band: CreditBand;
  credit_band_label: string;
  credit_source: 'self_declared' | 'bureau' | 'unavailable';
  selected_offer_id: string | null;
  created_at: string;
  offers: LoanOffer[];
}

export type LoanApplicationStatus =
  | 'draft' | 'submitted' | 'offers_ready' | 'partner_selected'
  | 'forwarded' | 'approved' | 'rejected' | 'withdrawn' | 'disbursed';

/**
 * An application as the admin queue returns it.
 *
 * Adds the contact details the applicant-facing shape deliberately omits.
 * The PAN stays masked here too — an admin who needs the full number for a
 * lender hand-off gets it from that hand-off, not from a list of everyone.
 */
export interface LoanApplicationAdmin extends LoanApplication {
  email: string | null;
  city: string | null;
  pincode: string | null;
  /** The lender they pressed "Continue with", already resolved to a name. */
  selected_partner_name: string | null;
  /** When they agreed to a credit check — the record that a call is expected. */
  credit_consent_at: string | null;
}

export interface LoanApplicationCreate {
  car_id?: string;
  listing_id?: string;
  vehicle_condition: 'new' | 'used';
  vehicle_description?: string;
  vehicle_year?: number;
  vehicle_price: number;
  applicant_name: string;
  mobile: string;
  email?: string;
  city?: string;
  pincode?: string;
  pan_number: string;
  employment_type: 'salaried' | 'self_employed' | 'business';
  employer_name?: string;
  monthly_income: number;
  existing_emi: number;
  down_payment: number;
  loan_amount: number;
  tenure_months: number;
  credit_score?: number | null;
  credit_consent: boolean;
}

/**
 * Client for the car loan module.
 *
 * The lender directory is public — a rate comparison table is a reason to visit
 * the page, and putting it behind a login means asking for an account before
 * showing anything worth having one for. Applying needs a session, because an
 * application carries a PAN and an income declaration.
 */
@Injectable({ providedIn: 'root' })
export class CarLoanService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // No Authorization header is set here: interceptors/auth.interceptor.ts
  // attaches the Supabase token to every request aimed at environment.apiUrl.

  async partners(): Promise<LendingPartner[]> {
    return firstValueFrom(this.http.get<LendingPartner[]>(`${this.apiUrl}/loans/partners`));
  }

  async apply(payload: LoanApplicationCreate): Promise<LoanApplication> {
    return firstValueFrom(
      this.http.post<LoanApplication>(`${this.apiUrl}/loans/applications`, payload),
    );
  }

  async myApplications(): Promise<LoanApplication[]> {
    return firstValueFrom(this.http.get<LoanApplication[]>(`${this.apiUrl}/loans/applications`));
  }

  /**
   * The admin queue: every application, with the details needed to ring the
   * applicant.
   *
   * Selecting a lender records the choice and nothing else — no application is
   * forwarded to the bank — so working the queue by phone is currently the only
   * way an applicant hears back at all.
   */
  async adminApplications(status?: LoanApplicationStatus, limit = 100):
      Promise<LoanApplicationAdmin[]> {
    let params = new HttpParams().set('limit', limit);
    if (status) params = params.set('status_filter', status);
    return firstValueFrom(
      this.http.get<LoanApplicationAdmin[]>(`${this.apiUrl}/loans/admin/applications`, { params }),
    );
  }

  async selectOffer(applicationId: string, offerId: string): Promise<LoanApplication> {
    return firstValueFrom(
      this.http.post<LoanApplication>(
        `${this.apiUrl}/loans/applications/${applicationId}/select`,
        { offer_id: offerId },
      ),
    );
  }

  /** ₹12,34,567 — Indian grouping, no decimals. Rupee precision is noise here. */
  formatRupees(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    return `₹${Math.round(value).toLocaleString('en-IN')}`;
  }

  /**
   * PAN format check, mirroring services/kyc.py.
   *
   * Client-side so the user is told before submitting, not instead of the
   * server check — the server validates again and is the authority.
   */
  isValidPan(pan: string): boolean {
    return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test((pan || '').toUpperCase().trim());
  }
}
