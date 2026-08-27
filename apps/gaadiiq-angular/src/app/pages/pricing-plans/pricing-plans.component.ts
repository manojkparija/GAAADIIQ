import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { SeoService } from '../../services/seo.service';
import { SubscriptionService, SubscriptionPlan } from '../../services/subscription.service';
import { AnalyticsService } from '../../services/analytics.service';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-pricing-plans',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './pricing-plans.component.html',
  styleUrl: './pricing-plans.component.scss',
})
export class PricingPlansComponent implements OnInit {
  readonly subs      = inject(SubscriptionService);
  readonly analytics = inject(AnalyticsService);
  readonly auth      = inject(AuthService);
  readonly http      = inject(HttpClient);

  billing      = signal<'monthly' | 'yearly'>('monthly');
  openFaq      = signal<number | null>(null);
  checkoutBusy = signal(false);

  plans   = computed(() => this.subs.plans());
  loading = computed(() => this.subs.loading());

  /**
   * Supabase plan id -> backend SubscriptionTier.
   *
   * The names differ because the tiers predate this page. seller_basic was
   * MISSING here, so the Seller Basic card — displayed with a ₹499 price —
   * fell through checkout() to a plain navigation. A plan was advertised at a
   * price that could not be bought.
   */
  private readonly TIER_MAP: Record<string, string> = {
    buyer_pro: 'pro',
    seller_basic: 'seller_basic',
    dealer_pro: 'dealer',
  };

  /**
   * What the server will actually charge, keyed by tier.
   *
   * WHY THE PAGE ASKS

   * The displayed price came from Supabase and the charged price from the API's
   * own table, with nothing keeping them in step. They drifted: the page said
   * ₹299 and the charge was ₹999 — 3.3x, discovered at the moment the customer
   * entered card details. Correcting the number fixed that day; reading the
   * price from the thing that charges it is what stops it recurring.
   *
   * Marketing copy stays in Supabase. The price does not.
   */
  serverPrices = signal<Record<string, number>>({});

  faqs = [
    { q: 'Can I cancel anytime?', a: 'Yes. Cancel anytime from your account settings — no questions asked, no lock-in periods.' },
    // WAS: "Buyer Pro includes a 7-day free trial. Dealer Pro includes a 14-day
    // free trial. No credit card required."
    //
    // No trial exists. Nothing in the API starts one, records when it began or
    // acts when it ends — SubscriptionTier has no trial state and Subscription
    // has no trial column. The claim was advertising, in the customer's own
    // words, a product that could not be delivered.
    //
    // Corrected rather than built: a trial is a real feature (eligibility,
    // start and expiry times, the action taken at expiry, repeat-trial abuse
    // prevention — TC-50..TC-53 of the QA plan), and shipping the promise ahead
    // of the mechanism is what created this. Restore the original wording in
    // the same commit that makes it true.
    { q: 'Is there a free trial?', a: 'Not at the moment. Every paid plan is monthly with no lock-in, so you can cancel any time if it is not right for you.' },
    { q: 'How does yearly billing work?', a: 'Pay once annually and save 2 months. Your plan renews automatically on the same date next year.' },
    { q: 'Can dealers list used cars?', a: 'Absolutely. Dealer Pro supports both new and used vehicle listings with full inventory management.' },
    { q: 'What payment methods are accepted?', a: 'UPI, credit/debit cards, net banking, and EMI via Razorpay — all major Indian payment methods.' },
  ];

  constructor(seo: SeoService) {
    seo.setPage('Pricing Plans', 'Flexible plans for buyers, sellers, and dealers on GAADIIQ — India\'s AI car marketplace.');
  }

  ngOnInit() {
    this.analytics.track('plan_viewed');
    this.loadServerPrices();
  }

  /**
   * Fetch the authoritative price list.
   *
   * Failure is deliberately quiet: the catalogue still renders from Supabase,
   * and a pricing page that refuses to load because one request failed is worse
   * than one showing a price it cannot currently confirm. What it must never do
   * is show a price it has been TOLD is wrong — see displayPrice.
   */
  private async loadServerPrices(): Promise<void> {
    try {
      const res: any = await this.http
        .get(`${environment.apiUrl}/subscriptions/plans`)
        .toPromise();
      const map: Record<string, number> = {};
      for (const p of res?.plans ?? []) map[p.tier] = p.amount_inr;
      this.serverPrices.set(map);
    } catch {
      /* leave empty; displayPrice falls back to the catalogue value */
    }
  }

  /**
   * The price the server will charge for this card, if we know it.
   *
   * A method, not a computed: it takes the plan as an argument, and a computed
   * over a non-signal argument evaluates once and then reports that first
   * answer forever — a mistake this codebase has shipped twice.
   */
  private serverPriceFor(plan: SubscriptionPlan): number | null {
    const tier = this.TIER_MAP[plan.id];
    if (!tier) return null;
    const p = this.serverPrices()[tier];
    return typeof p === 'number' ? p : null;
  }

  /** True when the catalogue and the server disagree about this plan's price. */
  priceMismatch(plan: SubscriptionPlan): boolean {
    const server = this.serverPriceFor(plan);
    if (server === null) return false;
    return server !== plan.monthly_price;
  }

  toggleFaq(i: number) { this.openFaq.update(v => v === i ? null : i); }

  displayPrice(plan: SubscriptionPlan): string {
    // Monthly billing shows the server's own figure whenever it is known, so
    // the number on the card is the number that will be charged. Yearly still
    // comes from the catalogue: the API prices a month, and inventing an annual
    // figure from it here would be the same two-sources-of-truth mistake in a
    // new place.
    const server = this.billing() === 'monthly' ? this.serverPriceFor(plan) : null;
    const p = server ?? this.subs.displayPrice(plan, this.billing());
    return p === 0 ? '₹0' : `₹${p.toLocaleString('en-IN')}`;
  }

  trackCta(plan: SubscriptionPlan) {
    this.analytics.track('plan_cta_clicked', { plan_id: plan.id });
  }

  savings(plan: SubscriptionPlan): number {
    return (plan.monthly_price - plan.yearly_price) * 12;
  }

  async checkout(plan: SubscriptionPlan): Promise<void> {
    const tier = this.TIER_MAP[plan.id];
    if (!tier) {
      // Free plan or unknown — navigate to register
      window.location.href = plan.cta_link;
      return;
    }
    if (!this.auth.isLoggedIn()) {
      window.location.href = '/login';
      return;
    }
    if (this.checkoutBusy()) return;
    this.checkoutBusy.set(true);
    this.analytics.track('plan_checkout_started', { plan_id: plan.id, tier });

    try {
      const order: any = await this.http
        .post(`${environment.apiUrl}/subscriptions/upgrade`, { tier })
        .toPromise();

      if (order.dev_mode) {
        alert(`✅ Dev mode — subscription activated (no payment needed).`);
        this.checkoutBusy.set(false);
        return;
      }

      const rzp = await this._loadRazorpay(order);
      rzp.open();
    } catch (err: any) {
      const msg = err?.error?.detail ?? 'Could not start checkout. Please try again.';
      alert(msg);
      this.checkoutBusy.set(false);
    }
  }

  private _loadRazorpay(order: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const existing = document.getElementById('rzp-script');
      const boot = () => {
        const options = {
          key: order.key_id,
          amount: order.amount_paise,
          currency: order.currency ?? 'INR',
          name: 'GAADIIQ',
          description: 'Subscription upgrade',
          order_id: order.razorpay_order_id,
          theme: { color: '#2B6BFF' },
          handler: async (response: any) => {
            try {
              await this.http.post(`${environment.apiUrl}/payments/verify`, {
                payment_id: order.payment_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }).toPromise();
              this.analytics.track('plan_checkout_success', { plan_id: order.payment_id });
              alert('✅ Payment successful! Your plan has been upgraded.');
            } catch {
              alert('Payment received but verification failed. Contact support.');
            } finally {
              this.checkoutBusy.set(false);
            }
          },
          modal: { ondismiss: () => this.checkoutBusy.set(false) },
        };
        resolve(new (window as any).Razorpay(options));
      };

      if (existing) { boot(); return; }
      const s = document.createElement('script');
      s.id = 'rzp-script';
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = boot;
      s.onerror = () => reject(new Error('Failed to load Razorpay SDK'));
      document.head.appendChild(s);
    });
  }
}
