import { Injectable, signal, computed } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';

export interface SubscriptionPlan {
  id:            string;
  name:          string;
  monthly_price: number;
  yearly_price:  number;
  badge:         string | null;
  badge_color:   string | null;
  description:   string;
  features:      string[];
  cta_label:     string;
  cta_link:      string;
  highlight:     boolean;
  sort_order:    number;
}

export interface UserSubscription {
  id:         string;
  plan_id:    string;
  billing:    'monthly' | 'yearly';
  status:     'trial' | 'active' | 'cancelled' | 'expired';
  started_at: string;
  expires_at: string | null;
}

@Injectable({ providedIn: 'root' })
export class SubscriptionService {
  plans          = signal<SubscriptionPlan[]>([]);
  currentSub     = signal<UserSubscription | null>(null);
  loading        = signal(true);

  currentPlanId  = computed(() => this.currentSub()?.plan_id ?? 'free_buyer');
  currentPlan    = computed(() => this.plans().find(p => p.id === this.currentPlanId()) ?? null);

  constructor(private sb: SupabaseService, private auth: AuthService) {
    this.loadPlans();
  }

  async loadPlans(): Promise<void> {
    this.loading.set(true);
    try {
      const { data, error } = await this.sb.client
        .from('subscription_plans')
        .select('*')
        .eq('active', true)
        .order('sort_order');

      if (!error && data) {
        this.plans.set(data as SubscriptionPlan[]);
      }
    } catch (e) {
      console.warn('[subscription] loadPlans failed:', e);
    } finally {
      this.loading.set(false);
    }
  }

  async loadUserSubscription(): Promise<void> {
    const email = this.auth.currentUser()?.email;
    if (!email) { this.currentSub.set(null); return; }

    const { data } = await this.sb.client
      .from('user_subscriptions')
      .select('*')
      .eq('user_email', email)
      .in('status', ['trial', 'active'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    this.currentSub.set(data as UserSubscription | null);
  }

  /** Returns plan display price based on billing cycle. */
  displayPrice(plan: SubscriptionPlan, billing: 'monthly' | 'yearly'): number {
    return billing === 'yearly' ? plan.yearly_price : plan.monthly_price;
  }

  /** Convenience: is user on a paid plan? */
  isPaid(): boolean {
    return !!this.currentSub() && this.currentPlanId() !== 'free_buyer';
  }

  canUseFeature(feature: 'unlimited_ai' | 'ai_valuation' | 'compare_5' | 'price_alerts' | 'dealer_dashboard'): boolean {
    const plan = this.currentPlanId();
    switch (feature) {
      case 'unlimited_ai':    return ['buyer_pro', 'dealer_pro'].includes(plan);
      case 'ai_valuation':    return ['buyer_pro', 'dealer_pro'].includes(plan);
      case 'compare_5':       return ['buyer_pro', 'dealer_pro'].includes(plan);
      case 'price_alerts':    return ['buyer_pro', 'seller_basic', 'dealer_pro'].includes(plan);
      case 'dealer_dashboard':return plan === 'dealer_pro';
      default:                return false;
    }
  }
}
