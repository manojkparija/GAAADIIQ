import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';

interface Plan {
  name: string;
  price: string;
  period: string;
  badge?: string;
  badgeColor?: string;
  desc: string;
  features: string[];
  cta: string;
  ctaLink: string;
  highlight: boolean;
}

@Component({
  selector: 'app-pricing-plans',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './pricing-plans.component.html',
  styleUrl: './pricing-plans.component.scss',
})
export class PricingPlansComponent {
  billing = signal<'monthly' | 'yearly'>('monthly');

  plans: Plan[] = [
    {
      name: 'Free Buyer',
      price: '₹0',
      period: 'forever',
      desc: 'Everything a car buyer needs to research and shortlist smarter.',
      features: [
        '✅ Browse all listings',
        '✅ AI Car Advisor (5 queries/day)',
        '✅ EMI Calculator',
        '✅ Compare up to 2 cars',
        '✅ 3 Price Alerts',
        '✅ Write reviews',
        '❌ Priority listings',
        '❌ Dealer contact details',
        '❌ AI Valuation',
      ],
      cta: 'Get Started Free',
      ctaLink: '/register',
      highlight: false,
    },
    {
      name: 'Buyer Pro',
      price: '₹299',
      period: '/month',
      badge: '⭐ Most Popular',
      badgeColor: 'purple',
      desc: 'Unlock the full buying intelligence stack for serious car shoppers.',
      features: [
        '✅ Everything in Free',
        '✅ Unlimited AI Car Advisor',
        '✅ Compare up to 5 cars',
        '✅ Unlimited Price Alerts',
        '✅ Full dealer contact details',
        '✅ AI Valuation reports',
        '✅ TCO & Resale analysis',
        '✅ Priority customer support',
        '❌ Dealer dashboard',
      ],
      cta: 'Start 7-Day Free Trial',
      ctaLink: '/register',
      highlight: true,
    },
    {
      name: 'Seller Basic',
      price: '₹499',
      period: '/month',
      desc: 'List your car and reach thousands of verified buyers.',
      features: [
        '✅ List up to 3 cars',
        '✅ AI-powered listing optimiser',
        '✅ Enquiry inbox',
        '✅ WhatsApp lead notifications',
        '✅ Basic analytics',
        '✅ 30-day listing duration',
        '❌ Featured placement',
        '❌ Bulk uploads',
        '❌ Dealer branding',
      ],
      cta: 'List Your Car',
      ctaLink: '/list-car',
      highlight: false,
    },
    {
      name: 'Dealer Pro',
      price: '₹2,499',
      period: '/month',
      badge: '🏢 Dealer',
      badgeColor: 'gold',
      desc: 'Full dealer intelligence platform for showrooms and used-car lots.',
      features: [
        '✅ Unlimited listings',
        '✅ Featured placement on search',
        '✅ Full Dealer Dashboard',
        '✅ Lead CRM with pipeline stages',
        '✅ Advanced analytics & reports',
        '✅ Bulk inventory upload (CSV)',
        '✅ Dealer branding & profile page',
        '✅ AI pricing recommendations',
        '✅ Dedicated account manager',
      ],
      cta: 'Start Dealer Trial',
      ctaLink: '/dealer-dashboard',
      highlight: false,
    },
  ];

  faqs = [
    { q: 'Can I cancel anytime?', a: 'Yes. Cancel anytime from your account settings — no questions asked, no lock-in periods.' },
    { q: 'Is there a free trial?', a: 'Buyer Pro includes a 7-day free trial. Dealer Pro includes a 14-day free trial. No credit card required.' },
    { q: 'How does yearly billing work?', a: 'Pay once annually and save 2 months. Your plan renews automatically on the same date next year.' },
    { q: 'Can dealers list used cars?', a: 'Absolutely. Dealer Pro supports both new and used vehicle listings with full inventory management.' },
    { q: 'What payment methods are accepted?', a: 'UPI, credit/debit cards, net banking, and EMI via Razorpay — all major Indian payment methods.' },
  ];

  openFaq = signal<number | null>(null);
  toggleFaq(i: number) { this.openFaq.update(v => v === i ? null : i); }

  get yearlyDiscount() { return this.billing() === 'yearly' ? 0.83 : 1; }
  yearlyPrice(p: Plan): string {
    if (p.price === '₹0') return '₹0';
    const num = parseInt(p.price.replace(/[^\d]/g, ''), 10);
    return `₹${Math.round(num * this.yearlyDiscount).toLocaleString('en-IN')}`;
  }

  constructor(seo: SeoService) {
    seo.setPage('Pricing Plans', 'Flexible plans for buyers, sellers, and dealers on GAADIIQ — India\'s AI car marketplace.');
  }
}
