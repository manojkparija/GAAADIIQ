import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

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
  currentPosition(): Promise<GeoFix> {
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

  /** Paise to a rupee string for display: 240000 -> "₹2,400". */
  formatPaise(paise: number): string {
    return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }
}
