import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/** The vehicle an enquiry is about. */
export interface InsuranceVehicle {
  make: string;
  model: string;
  variant?: string | null;
  fuel_type?: string | null;
  manufacturing_year?: number | null;
  registration_no?: string | null;
  city?: string | null;
  policy_type?: 'comprehensive' | 'third_party' | 'own_damage';
}

export interface InsuranceInterestRequest extends InsuranceVehicle {
  /** ISO date. The single most useful field on the form — see the page. */
  existing_policy_expiry?: string | null;
  existing_insurer?: string | null;
  name?: string | null;
  phone: string;
  email?: string | null;
  consent: boolean;
}

export interface InsuranceInterestAck {
  id: string;
  status: string;
  message: string;
}

/**
 * Why the partner is unavailable.
 *
 * `not_configured` is the expected state until a partner is onboarded, and the
 * page must treat it as normal rather than as an error: the user is offered the
 * interest form. `upstream_error` means a partner exists and is failing, which
 * is a real incident and reads differently to the user ("try again shortly").
 *
 * The distinction is the server's, not this file's guess — see
 * services/insurance/base.py::PartnerUnavailable.
 */
export type PartnerUnavailableReason =
  | 'not_configured'
  | 'upstream_error'
  | 'unsupported_product';

export class QuotesUnavailable extends Error {
  constructor(readonly reason: PartnerUnavailableReason, message: string) {
    super(message);
    this.name = 'QuotesUnavailable';
  }
}

/**
 * Motor insurance.
 *
 * THERE IS NO CLIENT-SIDE PREMIUM ESTIMATE IN THIS FILE, AND THERE MUST NOT BE.
 *
 * The obvious "helpful" addition here is a rough premium from IDV so the page
 * has a number on it before a partner is signed. The API refuses to invent one
 * (routers/insurance.py explains why at length: a fabricated premium is a
 * representation about a regulated financial product, indistinguishable from a
 * real one at the point of display). Computing it in the browser instead would
 * defeat that entirely while making it harder to find.
 *
 * Until a partner is onboarded, `fetchQuotes` throws QuotesUnavailable with
 * reason `not_configured` and the page shows the interest form. That is the
 * designed path, not a degraded one.
 */
@Injectable({ providedIn: 'root' })
export class InsuranceService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/insurance`;

  /**
   * Quotes from the configured partner.
   *
   * Throws QuotesUnavailable on 503 so the caller branches on the reason
   * rather than on a status code, and so an empty result can never be confused
   * with an unavailable one.
   */
  async fetchQuotes(vehicle: InsuranceVehicle): Promise<unknown> {
    try {
      return await firstValueFrom(this.http.post(`${this.base}/quotes`, vehicle));
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 503) {
        const detail = err.error?.detail ?? {};
        throw new QuotesUnavailable(
          detail.reason ?? 'not_configured',
          detail.message ?? 'Insurance quotes are not available yet.'
        );
      }
      throw err;
    }
  }

  /** Record that someone wants cover for this vehicle, with their consent. */
  async registerInterest(body: InsuranceInterestRequest): Promise<InsuranceInterestAck> {
    return firstValueFrom(
      this.http.post<InsuranceInterestAck>(`${this.base}/interest`, body)
    );
  }
}
