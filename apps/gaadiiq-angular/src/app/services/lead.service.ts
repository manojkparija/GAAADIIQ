import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface LeadRequest {
  phone: string;          // +91XXXXXXXXXX
  otp: string;
  city: string;
  locality?: string | null;
  pincode?: string | null;
  car_id?: string | null;
  make: string;
  model: string;
  variant?: string | null;
  name?: string | null;
  consent: boolean;
}

export interface LeadAck {
  received: boolean;
  city: string;
  /** How many verified dealers cover that city. Zero changes what we promise. */
  dealers_in_city: number;
}

/**
 * The "get offers" enquiry: send a code, then submit the lead with it.
 *
 * DELIBERATELY TWO CALLS, NOT THREE
 *
 * There is a /auth/otp/verify endpoint and this does not use it. A correct code
 * is consumed on verification, so calling it first would leave nothing for
 * POST /leads to check and the submit would fail with "OTP not found". The
 * server verifies the code as part of recording the lead — that is what ties
 * the phone number to a real person rather than to a claim, and it is why the
 * user sees a single "Verify" action rather than verify-then-submit.
 */
@Injectable({ providedIn: 'root' })
export class LeadService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  /** Normalises what a person types into the +91XXXXXXXXXX the API requires. */
  static toE164(raw: string): string | null {
    const digits = (raw ?? '').replace(/\D/g, '');
    const ten = digits.length > 10 ? digits.slice(-10) : digits;
    // Indian mobile numbers start 6-9; anything else would be rejected by the
    // API anyway, and saying so here saves the user an SMS round trip.
    return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : null;
  }

  async sendOtp(phone: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.api}/auth/otp/send`, { phone }),
    );
  }

  async submit(body: LeadRequest): Promise<LeadAck> {
    return await firstValueFrom(
      this.http.post<LeadAck>(`${this.api}/leads`, body),
    );
  }
}
