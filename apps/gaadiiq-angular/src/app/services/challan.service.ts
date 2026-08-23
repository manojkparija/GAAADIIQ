import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ChallanRow {
  challan_number: string | null;
  challan_date: string | null;
  amount: number | null;
  outstanding_amount: number | null;
  state: string | null;
  status: string | null;
  court_status: string | null;
}

export type ListingDecision =
  | 'verified'
  | 'manual_review'
  | 'blocked'
  | 'verification_pending';

export interface ChallanVerification {
  id: string;
  registration_number: string;
  verification_status: 'pending' | 'completed' | 'no_record_found' | 'failed';
  risk_category: 'unknown' | 'clear' | 'low' | 'moderate' | 'high' | 'court_review';
  listing_decision: ListingDecision;
  total_challan_count: number;
  outstanding_challan_count: number;
  total_outstanding_amount: number;
  /** Null when the check could not be completed. Never assume "clean". */
  verified_at: string | null;
  verification_expiry_at: string | null;
  decision_reason: string | null;
  /** Present only when no authorised source could answer. */
  unavailable_reason?: 'not_configured' | 'upstream_error' | 'unsupported_vehicle' | null;
  challans: ChallanRow[];
}

/**
 * Vehicle challan verification.
 *
 * The API returns a 200 with `unavailable_reason` set when it could not reach
 * an authorised source, rather than an error status. That is deliberate: the
 * attempt was recorded, the caller has a verification id, and the page needs
 * to render a real state — "we could not check" — not an exception.
 *
 * There is no client-side lookup here and there must not be. The obvious
 * shortcut is to open echallan.parivahan.gov.in in a frame or fetch it
 * directly; both fail on the CAPTCHA, and defeating a CAPTCHA on a government
 * portal is circumvention rather than integration. The page links the user to
 * that site instead so a human does the human step.
 */
@Injectable({ providedIn: 'root' })
export class ChallanService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/challan`;

  verify(registrationNumber: string): Promise<ChallanVerification> {
    return firstValueFrom(
      this.http.post<ChallanVerification>(`${this.base}/verify`, {
        registration_number: registrationNumber,
      })
    );
  }
}
