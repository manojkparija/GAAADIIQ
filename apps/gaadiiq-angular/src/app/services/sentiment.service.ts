import { Injectable, signal, computed } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';

export type LeadGrade = 'A' | 'B' | 'C' | 'D';

export interface IntentScore {
  user_id: string;
  customer_name: string;
  intent_score: number;
  lead_grade: LeadGrade;
  engagement_score: number;
  urgency_score: number;
  budget_fit_score: number;
  sentiment_score: number;
  next_best_action: string | null;
  best_contact_time: string | null;
  predicted_purchase_window: string | null;
  llm_reasoning: string | null;
  total_views: number;
  total_enquiries: number;
  total_test_drives: number;
  total_loan_inquiries: number;
  revisit_count: number;
  scored_at: string | null;
  ollama_used: boolean;
}

export interface Lead {
  user_id: string;
  customer_name: string;
  email: string | null;
  phone: string | null;
  intent_score: number;
  lead_grade: LeadGrade;
  next_best_action: string | null;
  best_contact_time: string | null;
  predicted_purchase_window: string | null;
  total_enquiries: number;
  total_test_drives: number;
  scored_at: string | null;
}

export interface SentimentSummary {
  total_leads: number;
  grade_a: number;
  grade_b: number;
  grade_c: number;
  grade_d: number;
  avg_score: number;
  hot_leads: number;
  needs_followup: number;
  analysed_today: number;
}

/**
 * Whether a buyer has agreed to have their activity reported to a dealer.
 *
 * There is no consent prompt in the application yet, so the honest answer is
 * no, everywhere. Flip this to the prompt's answer when one exists — one
 * constant so the answer cannot drift between the screens that report.
 */
export const BUYER_TRACKING_CONSENT = false;

export type ActivityType =
  | 'listing_view' | 'search' | 'enquiry' | 'test_drive_request'
  | 'loan_inquiry' | 'price_alert' | 'whatsapp_click' | 'photo_view'
  | 'compare' | 'revisit' | 'brochure_download';

@Injectable({ providedIn: 'root' })
export class SentimentService {
  private readonly api = `${environment.apiUrl}/sentiment`;

  leads = signal<Lead[]>([]);
  summary = signal<SentimentSummary | null>(null);
  loading = signal(false);
  analysingId = signal<string | null>(null);
  error = signal<string | null>(null);

  /** The summary call failed, as distinct from a dealer who genuinely has none. */
  summaryFailed = signal(false);

  gradeALeads = computed(() => this.leads().filter(l => l.lead_grade === 'A'));
  gradeBLeads = computed(() => this.leads().filter(l => l.lead_grade === 'B'));

  constructor(private http: HttpClient) {}

  async loadLeads(grade?: LeadGrade, minScore = 0): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      let params = new HttpParams().set('min_score', minScore);
      if (grade) params = params.set('grade', grade);
      const data = await this.http
        .get<Lead[]>(`${this.api}/leads`, { params })
        .toPromise();
      this.leads.set(data ?? []);
    } catch (e: any) {
      // Empty, never invented. This used to fall back to six fabricated leads
      // — names, e-mail addresses and mobile numbers, scored and ranked, with
      // scored_at set to the current time so they always looked freshly
      // analysed. /sentiment/leads has been returning 403 on every dashboard
      // load in production, which means that is what dealers have been seeing:
      // a full lead list for customers who do not exist, with "Schedule test
      // drive immediately" beside a phone number someone might actually ring.
      //
      // The failure was invisible precisely because the fallback looked right.
      this.error.set(e?.error?.detail ?? 'Failed to load leads');
      this.leads.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  async loadSummary(): Promise<void> {
    this.summaryFailed.set(false);
    try {
      const data = await this.http.get<SentimentSummary>(`${this.api}/summary`).toPromise();
      this.summary.set(data ?? null);
    } catch {
      // Same rule. The demo summary claimed "6 leads, 2 hot, avg score 66.2"
      // regardless of what the dealer actually had.
      this.summary.set(null);
      this.summaryFailed.set(true);
    }
  }

  async analyseCustomer(userId: string, name = 'Customer'): Promise<IntentScore | null> {
    this.analysingId.set(userId);
    try {
      const result = await this.http
        .post<IntentScore>(`${this.api}/analyse/${userId}`, { customer_name: name })
        .toPromise();
      if (result) {
        // Update the lead in place
        this.leads.update(leads =>
          leads.map(l => l.user_id === userId
            ? { ...l, intent_score: result.intent_score, lead_grade: result.lead_grade,
                next_best_action: result.next_best_action, scored_at: result.scored_at }
            : l
          )
        );
      }
      return result ?? null;
    } catch (e: any) {
      this.error.set(e?.error?.detail ?? 'Analysis failed');
      return null;
    } finally {
      this.analysingId.set(null);
    }
  }

  /**
   * Record a buyer's activity for a dealer — only where the buyer has agreed
   * to it.
   *
   * The endpoint requires an explicit consent flag (MOB-032) and rejects the
   * request without one. This client never sent it, so every call returned 422
   * and the caller swallowed the failure: the server logged a steady stream of
   * rejected requests, no activity was ever recorded, and nothing said so.
   *
   * Passing `consent: true` unconditionally would fix the log and forge the
   * agreement. There is no consent prompt in this application yet, so there is
   * nothing truthful to send — and until there is, the honest request is no
   * request. When a prompt exists, pass its answer here.
   */
  async trackPublic(
    dealerEmail: string,
    buyerId: string,
    activityType: ActivityType,
    consent: boolean,
    durationSeconds?: number,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!consent) return;
    try {
      await this.http.post(`${this.api}/track-public`, {
        dealer_email: dealerEmail,
        buyer_id: buyerId,
        activity_type: activityType,
        consent,
        duration_seconds: durationSeconds,
        metadata,
      }).toPromise();
    } catch {
      // Non-critical — swallow silently
    }
  }

  async trackActivity(
    userId: string,
    activityType: ActivityType,
    listingId?: string,
    durationSeconds?: number,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.http.post(`${this.api}/track`, {
        user_id: userId,
        activity_type: activityType,
        listing_id: listingId,
        duration_seconds: durationSeconds,
        metadata,
      }).toPromise();
    } catch {
      // Non-critical — swallow silently
    }
  }

  gradeColor(grade: LeadGrade): string {
    return { A: '#EF4444', B: '#F59E0B', C: '#3B82F6', D: '#6B7280' }[grade];
  }

  gradeBg(grade: LeadGrade): string {
    return { A: 'rgba(239,68,68,0.12)', B: 'rgba(245,158,11,0.12)',
             C: 'rgba(59,130,246,0.12)', D: 'rgba(107,114,128,0.12)' }[grade];
  }

  scoreColor(score: number): string {
    if (score >= 80) return '#EF4444';
    if (score >= 60) return '#F59E0B';
    if (score >= 40) return '#3B82F6';
    return '#6B7280';
  }
}
