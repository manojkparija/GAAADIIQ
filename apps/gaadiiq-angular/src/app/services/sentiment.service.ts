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
      this.error.set(e?.error?.detail ?? 'Failed to load leads');
      this.leads.set(this._demoLeads());
    } finally {
      this.loading.set(false);
    }
  }

  async loadSummary(): Promise<void> {
    try {
      const data = await this.http.get<SentimentSummary>(`${this.api}/summary`).toPromise();
      this.summary.set(data ?? null);
    } catch {
      this.summary.set(this._demoSummary());
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

  async trackPublic(
    dealerEmail: string,
    buyerId: string,
    activityType: ActivityType,
    durationSeconds?: number,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.http.post(`${this.api}/track-public`, {
        dealer_email: dealerEmail,
        buyer_id: buyerId,
        activity_type: activityType,
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

  // ── Demo data (shown when API is unreachable) ─────────────────────────────
  private _demoLeads(): Lead[] {
    return [
      { user_id: 'u1', customer_name: 'Arjun Mehta', email: 'arjun@example.com', phone: '+91 98765 43210', intent_score: 92, lead_grade: 'A', next_best_action: 'Schedule test drive immediately', best_contact_time: 'Morning 10am–12pm', predicted_purchase_window: 'This week', total_enquiries: 3, total_test_drives: 1, scored_at: new Date().toISOString() },
      { user_id: 'u2', customer_name: 'Priya Nair', email: 'priya@example.com', phone: '+91 98745 12340', intent_score: 85, lead_grade: 'A', next_best_action: 'Send EMI & finance offer', best_contact_time: 'Evening 6–8pm', predicted_purchase_window: 'This week', total_enquiries: 2, total_test_drives: 1, scored_at: new Date().toISOString() },
      { user_id: 'u3', customer_name: 'Deepak Rao', email: 'deepak@example.com', phone: '+91 95643 21098', intent_score: 79, lead_grade: 'B', next_best_action: 'Share subsidy & EV benefits', best_contact_time: 'Morning 9–11am', predicted_purchase_window: '1-2 weeks', total_enquiries: 2, total_test_drives: 0, scored_at: new Date().toISOString() },
      { user_id: 'u4', customer_name: 'Sneha Joshi', email: 'sneha@example.com', phone: '+91 96754 32109', intent_score: 61, lead_grade: 'B', next_best_action: 'Send digital brochure', best_contact_time: 'Noon 12–2pm', predicted_purchase_window: '1-2 weeks', total_enquiries: 1, total_test_drives: 0, scored_at: new Date().toISOString() },
      { user_id: 'u5', customer_name: 'Ravi Kumar', email: 'ravi@example.com', phone: '+91 97865 43201', intent_score: 48, lead_grade: 'C', next_best_action: 'Add to drip email sequence', best_contact_time: 'Evening 5–7pm', predicted_purchase_window: '1 month', total_enquiries: 1, total_test_drives: 0, scored_at: new Date().toISOString() },
      { user_id: 'u6', customer_name: 'Lalita Sharma', email: 'lalita@example.com', phone: '+91 94532 10987', intent_score: 32, lead_grade: 'D', next_best_action: 'Re-engage via WhatsApp', best_contact_time: 'Evening 7–9pm', predicted_purchase_window: '3+ months', total_enquiries: 0, total_test_drives: 0, scored_at: new Date().toISOString() },
    ];
  }

  private _demoSummary(): SentimentSummary {
    return { total_leads: 6, grade_a: 2, grade_b: 2, grade_c: 1, grade_d: 1,
             avg_score: 66.2, hot_leads: 2, needs_followup: 1, analysed_today: 4 };
  }
}
