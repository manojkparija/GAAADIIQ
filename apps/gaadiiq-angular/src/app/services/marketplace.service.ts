import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { NativeService } from './native.service';

/** A mechanic as a customer is allowed to see them — no KYC fields. */
export interface NearbyMechanic {
  id: string;
  full_name: string;
  shop_name: string | null;
  phone: string;
  city: string;
  area_pincode: string;
  specialisations: string[] | null;
  rating: number | null;
  jobs_completed: number;
  distance_km: number | null;
}

export interface ServiceRequest {
  id: string;
  reference: string;
  car_number: string;
  manufacturer: string | null;
  model: string | null;
  latitude: number;
  longitude: number;
  problem_summary: string;
  severity: string | null;
  status: 'open' | 'assigned' | 'in_progress' | 'awaiting_payment' | 'paid' | 'completed' | 'cancelled';
  quoted_amount_paise: number | null;
  final_amount_paise: number | null;
  matched_distance_km: number | null;
  mechanic: NearbyMechanic | null;
  created_at: string;
}

/** The split, shown to both sides before money moves. */
export interface CommissionPreview {
  gross_paise: number;
  commission_paise: number;
  mechanic_payout_paise: number;
  commission_rate_bps: number;
  effective_rate_pct: number;
}

export interface ServicePayment {
  payment_id: string;
  service_request_id: string;
  reference: string;
  amount_paise: number;
  razorpay_order_id: string | null;
  /** Tappable on mobile; the QR below is for paying from another device. */
  upi_uri: string | null;
  upi_qr_data_uri: string | null;
  commission: CommissionPreview;
}

/** The mechanic's own record — includes KYC fields, so only ever their own. */
export interface MechanicProfile {
  id: string;
  full_name: string;
  shop_name: string | null;
  phone: string;
  city: string;
  state: string;
  area_pincode: string;
  service_radius_km: number;
  pan_number: string;
  aadhaar_masked: string;
  upi_vpa: string | null;
  specialisations: string[] | null;
  status: 'pending_verification' | 'active' | 'suspended' | 'rejected';
  is_available: boolean;
  rating: number | null;
  jobs_completed: number;
}

export interface MechanicRegistration {
  full_name: string;
  shop_name?: string;
  phone: string;
  whatsapp_phone?: string;
  email?: string;
  address_line1: string;
  city: string;
  state: string;
  area_pincode: string;
  latitude?: number;
  longitude?: number;
  service_radius_km?: number;
  pan_number: string;
  /** Sent once, never stored — see services/kyc.py. */
  aadhaar_number: string;
  upi_vpa?: string;
  specialisations?: string[];
}

export interface CreateServiceRequest {
  car_number: string;
  manufacturer?: string;
  model?: string;
  model_year?: number;
  fuel_type?: string;
  latitude: number;
  longitude: number;
  location_accuracy_m?: number;
  address_text?: string;
  landmark?: string;
  contact_phone?: string;
  problem_summary: string;
  severity?: string;
  is_vehicle_drivable?: boolean;
  diagnosis_id?: string;
}

export interface GeoFix {
  latitude: number;
  longitude: number;
  accuracy_m: number;
}

/**
 * A broadcast job as the mechanic sees it *before* accepting.
 *
 * Deliberately has no customer name, phone number or coordinates. The server
 * does not send them, and it should not: a 1 km broadcast reaches every
 * mechanic in the area at once, and none of them has committed to anything yet.
 * Those fields arrive on the ServiceRequest once this mechanic has won the job.
 */
export interface JobOffer {
  offer_id: string;
  request_id: string;
  reference: string;
  distance_km: number;
  problem_summary: string;
  severity: string | null;
  is_vehicle_drivable: boolean | null;
  manufacturer: string | null;
  model: string | null;
  pincode: string | null;
  landmark: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface AcceptResult {
  won: boolean;
  request_id: string;
  message: string;
  request: ServiceRequest | null;
}

export interface DispatchResult {
  request_id: string;
  reference: string;
  radius_km: number;
  offers_sent: number;
  expires_at: string | null;
  message: string;
}

export interface StartOtp {
  request_id: string;
  reference: string;
  otp: string;
  issued_at: string;
}

/**
 * Client for the roadside repair marketplace.
 *
 * Two halves with deliberately different auth requirements: finding a mechanic
 * is public, because a stranded driver may not be logged in and making them
 * sign up before they can see who is nearby is the wrong trade at the roadside.
 * Raising a request and paying for it need an account.
 */
@Injectable({ providedIn: 'root' })
export class MarketplaceService {
  private readonly http = inject(HttpClient);
  private readonly native = inject(NativeService);
  private readonly apiUrl = environment.apiUrl;

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // No Authorization header is set anywhere in this file on purpose:
  // interceptors/auth.interceptor.ts attaches the Supabase session token to
  // every request aimed at environment.apiUrl. Setting one here would shadow it.

  /**
   * The browser's current position.
   *
   * Rejects rather than falling back to a city centre: the whole point of the
   * feature is dispatching to where the car actually is, and a silently wrong
   * position is worse than asking the user to enable location.
   */
  async currentPosition(): Promise<GeoFix> {
    // In the Android/iOS shell, go through the Capacitor plugin.
    //
    // navigator.geolocation inside a WebView never triggers Android's runtime
    // permission request. ACCESS_FINE_LOCATION is declared in the manifest, but
    // on Android 6+ declaring is not granting, and nothing else in the app asks
    // — so on a phone this rejected with "Location access was blocked" and the
    // driver was told to enable a permission they had never been offered.
    //
    // The plugin asks, then answers. On the web this is skipped entirely and
    // the browser path below is unchanged.
    if (this.native.isNative) {
      const pos = await this.native.getCurrentPosition();
      if (!pos) throw new Error('Could not get your location. Check that location services are on.');
      return {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy,
      };
    }

    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('This browser cannot share your location.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy,
        }),
        err => reject(new Error(
          err.code === err.PERMISSION_DENIED
            ? 'Location access was blocked. Allow it so we can find mechanics near your car.'
            : 'Could not get your location. Check that location services are on.',
        )),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
      );
    });
  }

  /** Active mechanics near a point, nearest first. Public — no token needed. */
  async nearby(lat: number, lng: number, radiusKm = 0, limit = 10): Promise<NearbyMechanic[]> {
    const params: Record<string, string> = {
      latitude: String(lat),
      longitude: String(lng),
      limit: String(limit),
    };
    if (radiusKm) params['radius_km'] = String(radiusKm);
    return firstValueFrom(
      this.http.get<NearbyMechanic[]>(`${this.apiUrl}/mechanics/nearby`, { params }),
    );
  }

  async createRequest(payload: CreateServiceRequest): Promise<ServiceRequest> {
    return firstValueFrom(
      this.http.post<ServiceRequest>(`${this.apiUrl}/service-requests`, payload),
    );
  }

  async assignMechanic(requestId: string, mechanicId: string): Promise<ServiceRequest> {
    return firstValueFrom(
      this.http.post<ServiceRequest>(
        `${this.apiUrl}/service-requests/${requestId}/assign`,
        { mechanic_id: mechanicId },
      ),
    );
  }

  /** Opens a payment and returns the scan-to-pay details. */
  async startPayment(requestId: string): Promise<ServicePayment> {
    return firstValueFrom(
      this.http.post<ServicePayment>(
        `${this.apiUrl}/service-requests/${requestId}/pay`,
        {},
      ),
    );
  }

  async verifyPayment(requestId: string, razorpay?: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }): Promise<ServiceRequest> {
    return firstValueFrom(
      this.http.post<ServiceRequest>(
        `${this.apiUrl}/service-requests/${requestId}/pay/verify`,
        razorpay ?? {},
      ),
    );
  }

  async myRequests(limit = 20): Promise<ServiceRequest[]> {
    return firstValueFrom(
      this.http.get<ServiceRequest[]>(`${this.apiUrl}/service-requests`, {
        params: { limit: String(limit) },
      }),
    );
  }

  // ── Mechanic side ─────────────────────────────────────────────────────────

  /**
   * The mechanic profile linked to the signed-in account, or null.
   *
   * A 404 is the API saying "you are not a mechanic", which is an ordinary
   * answer rather than a failure — it is how the dashboard knows to offer
   * registration instead of a job list.
   */
  /**
   * Register as a mechanic.
   *
   * Send this while signed in: the API links the new row to the caller's
   * account, and without that link the mechanic cannot later quote their own
   * jobs. The Aadhaar number is validated server-side and never stored — only a
   * hash and the last four digits survive.
   */
  async registerMechanic(payload: MechanicRegistration): Promise<MechanicProfile> {
    return firstValueFrom(
      this.http.post<MechanicProfile>(`${this.apiUrl}/mechanics`, payload),
    );
  }

  async myMechanicProfile(): Promise<MechanicProfile | null> {
    try {
      return await firstValueFrom(
        this.http.get<MechanicProfile>(`${this.apiUrl}/mechanics/me`),
      );
    } catch (e) {
      if ((e as { status?: number })?.status === 404) return null;
      throw e;
    }
  }

  /** Jobs assigned to the caller's mechanic, newest first. */
  async assignedToMe(limit = 50): Promise<ServiceRequest[]> {
    return firstValueFrom(
      this.http.get<ServiceRequest[]>(`${this.apiUrl}/service-requests/assigned-to-me`, {
        params: { limit: String(limit) },
      }),
    );
  }

  /** Mechanic accepts the job: assigned -> in_progress. */
  // ── Dispatch: broadcast, accept, arrival OTP ──────────────────────────────

  /** Broadcast an open request to available mechanics nearby (customer). */
  async dispatch(requestId: string, radiusKm?: number): Promise<DispatchResult> {
    return firstValueFrom(
      this.http.post<DispatchResult>(
        `${this.apiUrl}/service-requests/${requestId}/dispatch`,
        radiusKm ? { radius_km: radiusKm } : {},
      ),
    );
  }

  /** Live job offers for the signed-in mechanic, nearest first. */
  async myOffers(): Promise<JobOffer[]> {
    return firstValueFrom(
      this.http.get<JobOffer[]>(`${this.apiUrl}/service-requests/offers/available`),
    );
  }

  /**
   * Claim a broadcast job.
   *
   * `won: false` is an ordinary outcome, not an error — someone else was
   * quicker. The server returns 200 for it precisely so the caller does not
   * have to tell a lost race apart from a real failure by reading a status code.
   */
  async acceptOffer(requestId: string): Promise<AcceptResult> {
    return firstValueFrom(
      this.http.post<AcceptResult>(`${this.apiUrl}/service-requests/${requestId}/accept`, {}),
    );
  }

  /** Pass on a job, leaving it open for the other mechanics. */
  async declineOffer(requestId: string): Promise<void> {
    await firstValueFrom(
      this.http.post<void>(`${this.apiUrl}/service-requests/${requestId}/decline`, {}),
    );
  }

  /**
   * The arrival code, for the customer who raised the request.
   *
   * Only ever called from the customer's own screen. Each call mints a fresh
   * code and retires the previous one, so this is not a "peek" — do not call it
   * on a timer or on every render.
   */
  async startOtp(requestId: string): Promise<StartOtp> {
    return firstValueFrom(
      this.http.get<StartOtp>(`${this.apiUrl}/service-requests/${requestId}/start-otp`),
    );
  }

  /** Mechanic enters the customer's code on arrival; the job starts. */
  async verifyStartOtp(requestId: string, otp: string): Promise<ServiceRequest> {
    return firstValueFrom(
      this.http.post<ServiceRequest>(
        `${this.apiUrl}/service-requests/${requestId}/verify-start-otp`,
        { otp },
      ),
    );
  }

  async startWork(requestId: string): Promise<ServiceRequest> {
    return firstValueFrom(
      this.http.post<ServiceRequest>(`${this.apiUrl}/service-requests/${requestId}/start`, {}),
    );
  }

  /**
   * Price the job. Rupees in, paise on the wire — money never crosses the
   * network as a float.
   */
  async quote(requestId: string, amountRupees: number): Promise<CommissionPreview> {
    return firstValueFrom(
      this.http.post<CommissionPreview>(
        `${this.apiUrl}/service-requests/${requestId}/quote`,
        { amount_paise: Math.round(amountRupees * 100) },
      ),
    );
  }

  async completeRequest(requestId: string): Promise<ServiceRequest> {
    return firstValueFrom(
      this.http.post<ServiceRequest>(`${this.apiUrl}/service-requests/${requestId}/complete`, {}),
    );
  }

  async setAvailability(mechanicId: string, isAvailable: boolean): Promise<MechanicProfile> {
    return firstValueFrom(
      this.http.patch<MechanicProfile>(
        `${this.apiUrl}/mechanics/${mechanicId}/availability`,
        { is_available: isAvailable },
      ),
    );
  }

  /** Paise to a rupee string for display: 240000 -> "₹2,400". */
  formatPaise(paise: number): string {
    return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
}
