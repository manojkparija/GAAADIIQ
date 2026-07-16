import { Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { CityService } from './city.service';

export type EventType =
  | 'page_view'
  | 'car_view'
  | 'car_compare_add'
  | 'ai_query'
  | 'ai_result_view'
  | 'search'
  | 'filter_apply'
  | 'price_alert_set'
  | 'test_drive_book'
  | 'listing_created'
  | 'listing_price_edit'
  | 'journey_complete'
  | 'journey_retake'
  | 'plan_viewed'
  | 'plan_cta_clicked'
  | 'login'
  | 'register'
  | 'logout';

export interface EventData {
  car_id?:    string;
  make?:      string;
  model?:     string;
  query?:     string;
  plan_id?:   string;
  budget?:    string;
  fuel?:      string;
  body_type?: string;
  price?:     number;
  [key: string]: unknown;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly sessionId = this.makeSessionId();

  constructor(
    private sb:   SupabaseService,
    private auth: AuthService,
    private city: CityService,
  ) {}

  /** Fire-and-forget event track — never throws. */
  track(type: EventType, data?: EventData, page?: string): void {
    const payload = {
      user_email: this.auth.currentUser()?.email ?? null,
      session_id: this.sessionId,
      event_type: type,
      event_data: data ?? null,
      page:       page ?? (typeof window !== 'undefined' ? window.location.pathname : null),
      city:       this.city.selectedCity() ?? null,
    };

    this.sb.client.from('user_events').insert(payload)
      .then(({ error }) => {
        if (error) console.warn('[analytics] track failed:', error.message);
      });

    // Update sentiment scores in background after high-intent events
    if (this.auth.currentUser()?.email && this.isHighIntent(type)) {
      this.refreshSentiment(this.auth.currentUser()!.email);
    }
  }

  private isHighIntent(type: EventType): boolean {
    return ['ai_query', 'price_alert_set', 'test_drive_book', 'plan_cta_clicked', 'journey_complete'].includes(type);
  }

  /** Recompute + upsert user_sentiment row from their raw events. */
  private async refreshSentiment(email: string): Promise<void> {
    try {
      const { data: events } = await this.sb.client
        .from('user_events')
        .select('event_type, event_data, created_at')
        .eq('user_email', email)
        .order('created_at', { ascending: false })
        .limit(200);

      if (!events?.length) return;

      const now     = Date.now();
      const dayMs   = 86_400_000;
      const weekMs  = 7 * dayMs;

      let engagement = 0;
      let intent     = 0;

      const intentWeights: Record<string, number> = {
        test_drive_book:  15,
        price_alert_set:  10,
        ai_query:          8,
        plan_cta_clicked: 12,
        journey_complete:  8,
        car_view:          3,
        car_compare_add:   5,
        search:            2,
        page_view:         1,
      };

      const budgets: string[]    = [];
      const fuels:   string[]    = [];
      const bodies:  string[]    = [];
      let lastActive: string     = events[0].created_at;

      for (const ev of events) {
        const age = now - new Date(ev.created_at).getTime();
        // Recency multiplier: 2× within a week, 1× within a month, 0.5× older
        const recency = age < weekMs ? 2 : age < 30 * dayMs ? 1 : 0.5;

        engagement += recency * 2;
        intent     += (intentWeights[ev.event_type] ?? 0) * recency;

        const d = ev.event_data as EventData | null;
        if (d?.budget)    budgets.push(d.budget);
        if (d?.fuel)      fuels.push(d.fuel);
        if (d?.body_type) bodies.push(d.body_type);
      }

      engagement = Math.min(100, Math.round(engagement));
      intent     = Math.min(100, Math.round(intent));

      const label =
        intent >= 50  ? 'hot_lead'        :
        intent >= 25  ? 'active_browser'  :
        engagement >= 20 ? 'returning_buyer' :
        engagement >= 5  ? 'passive'      : 'churned';

      const topFuel   = this.mostCommon(fuels);
      const topBudget = this.mostCommon(budgets);
      const topBody   = this.mostCommon(bodies);

      const interest =
        topFuel === 'Electric' ? 'ev' :
        topBody === 'SUV / Compact SUV' ? 'suv' :
        topBudget === 'Under ₹5L' || topBudget === '₹5L–₹10L' ? 'budget' :
        topBudget === 'Above ₹20L' ? 'luxury' : null;

      await this.sb.client.from('user_sentiment').upsert({
        user_email:       email,
        engagement_score: engagement,
        intent_score:     intent,
        sentiment_label:  label,
        top_interest:     interest,
        preferred_budget: topBudget,
        preferred_fuel:   topFuel,
        event_count:      events.length,
        last_active_at:   lastActive,
        updated_at:       new Date().toISOString(),
      }, { onConflict: 'user_email' });
    } catch (e) {
      console.warn('[analytics] refreshSentiment error:', e);
    }
  }

  private mostCommon(arr: string[]): string | null {
    if (!arr.length) return null;
    const counts = arr.reduce<Record<string, number>>((acc, v) => {
      acc[v] = (acc[v] ?? 0) + 1; return acc;
    }, {});
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  private makeSessionId(): string {
    const key = 'gaadiiq_sid';
    let sid = sessionStorage.getItem(key);
    if (!sid) { sid = crypto.randomUUID(); sessionStorage.setItem(key, sid); }
    return sid;
  }
}
