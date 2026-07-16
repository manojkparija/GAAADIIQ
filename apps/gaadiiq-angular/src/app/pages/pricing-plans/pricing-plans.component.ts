import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';
import { SubscriptionService, SubscriptionPlan } from '../../services/subscription.service';
import { AnalyticsService } from '../../services/analytics.service';

@Component({
  selector: 'app-pricing-plans',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './pricing-plans.component.html',
  styleUrl: './pricing-plans.component.scss',
})
export class PricingPlansComponent implements OnInit {
  readonly subs    = inject(SubscriptionService);
  readonly analytics = inject(AnalyticsService);

  billing  = signal<'monthly' | 'yearly'>('monthly');
  openFaq  = signal<number | null>(null);

  plans    = computed(() => this.subs.plans());
  loading  = computed(() => this.subs.loading());

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
}
