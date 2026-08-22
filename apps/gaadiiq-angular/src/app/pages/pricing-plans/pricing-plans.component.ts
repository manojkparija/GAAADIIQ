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

  /** Plan IDs (from Supabase) that map to Razorpay subscription tiers */
  private readonly TIER_MAP: Record<string, string> = {
    buyer_pro: 'pro',
    dealer_pro: 'dealer',
  };

  faqs = [
    { q: 'Can I cancel anytime?', a: 'Yes. Cancel anytime from your account settings — no questions asked, no lock-in periods.' },
    { q: 'Is there a free trial?', a: 'Buyer Pro includes a 7-day free trial. Dealer Pro includes a 14-day free trial. No credit card required.' },
    { q: 'How does yearly billing work?', a: 'Pay once annually and save 2 months. Your plan renews automatically on the same date next year.' },
    { q: 'Can dealers list used cars?', a: 'Absolutely. Dealer Pro supports both new and used vehicle listings with full inventory management.' },
    { q: 'What payment methods are accepted?', a: 'UPI, credit/debit cards, net banking, and EMI via Razorpay — all major Indian payment methods.' },
  ];

  constructor(seo: SeoService) {
    seo.setPage('Pricing Plans', 'Flexible plans for buyers, sellers, and dealers on GAADIIQ — India\'s AI car marketplace.');
  }

  ngOnInit() {
    this.analytics.track('plan_viewed');
  }

  toggleFaq(i: number) { this.openFaq.update(v => v === i ? null : i); }

  displayPrice(plan: SubscriptionPlan): string {
    const p = this.subs.displayPrice(plan, this.billing());
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
