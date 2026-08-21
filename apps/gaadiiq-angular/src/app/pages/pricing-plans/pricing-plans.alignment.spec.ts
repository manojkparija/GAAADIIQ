/**
 * The four plan prices sit on one line across the row.
 *
 * Two of the four plans carry a badge ("Most Popular", "Dealer"). The badge
 * was rendered with *ngIf, so on those two cards it occupied a row and pushed
 * the name and price down, while the other two started higher — leaving the
 * four prices at two different heights in a row of cards whose entire purpose
 * is comparing exactly those numbers.
 *
 * This measures geometry in a real browser rather than asserting on classes:
 * the bug was visible only as position, and a class assertion would have
 * passed throughout it. Karma loads src/styles.scss (see angular.json), so the
 * cascade here is the same one the page renders under.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { PricingPlansComponent } from './pricing-plans.component';
import { SubscriptionService } from '../../services/subscription.service';
import { AnalyticsService } from '../../services/analytics.service';
import { AuthService } from '../../services/auth.service';

const PLANS = [
  { id: 'free_buyer', name: 'Free Buyer', monthly_price: 0, yearly_price: 0,
    badge: null, badge_color: 'purple', highlight: false,
    description: 'Everything a car buyer needs to research and shortlist smarter.',
    features: ['Browse all listings', 'EMI Calculator'], cta_label: 'Get Started Free' },
  { id: 'buyer_pro', name: 'Buyer Pro', monthly_price: 299, yearly_price: 249,
    badge: '⭐ Most Popular', badge_color: 'purple', highlight: true,
    description: 'Unlock the full buying intelligence stack for serious car shoppers.',
    features: ['Everything in Free', 'Unlimited AI Car Advisor'], cta_label: 'Start 7-Day Free Trial' },
  { id: 'seller_basic', name: 'Seller Basic', monthly_price: 499, yearly_price: 415,
    badge: null, badge_color: 'purple', highlight: false,
    description: 'List your car and reach thousands of verified buyers.',
    features: ['List up to 3 cars', 'Enquiry inbox'], cta_label: 'List Your Car' },
  { id: 'dealer_pro', name: 'Dealer Pro', monthly_price: 2499, yearly_price: 2082,
    badge: '🏢 Dealer', badge_color: 'gold', highlight: false,
    description: 'Full dealer intelligence platform for showrooms and used-car lots.',
    features: ['Unlimited listings', 'Lead CRM'], cta_label: 'Start Dealer Trial' },
] as any[];

describe('pricing plans — card alignment', () => {
  let fixture: ComponentFixture<PricingPlansComponent>;
  let comp: PricingPlansComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PricingPlansComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        {
          provide: SubscriptionService,
          useValue: {
            plans: signal(PLANS),
            loading: signal(false),
            displayPrice: (p: any, billing: string) =>
              billing === 'yearly' ? p.yearly_price : p.monthly_price,
          },
        },
        { provide: AnalyticsService, useValue: { track: () => {} } },
        { provide: AuthService, useValue: { currentUser: signal(null), isAdmin: () => false } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PricingPlansComponent);
    comp = fixture.componentInstance;
    fixture.detectChanges();
    // The cards must actually be laid out for a measurement to mean anything;
    // a detached fixture reports every rect as zero.
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  /**
   * Each element's offset from the top of its own card.
   *
   * Not the absolute viewport top, which the first version of this spec used
   * and which measured the wrong thing: Karma's window is narrower than
   * 1100px, so .plans-grid drops to two columns and cards 3 and 4 sit on a
   * second row 400px lower. That reported four distinct values on a perfectly
   * aligned row. The offset within the card is the invariant that actually
   * matters, and it holds however the grid wraps.
   */
  function offsetsWithinCard(selector: string): number[] {
    const cards: HTMLElement[] =
      Array.from(fixture.nativeElement.querySelectorAll('.plan-card'));
    return cards.map(card => {
      const el = card.querySelector(selector) as HTMLElement;
      expect(el).withContext(`no ${selector} in a card`).toBeTruthy();
      return Math.round(
        el.getBoundingClientRect().top - card.getBoundingClientRect().top,
      );
    });
  }

  it('renders all four plans', () => {
    expect(fixture.nativeElement.querySelectorAll('.plan-card').length).toBe(4);
  });

  it('puts every price at the same height (monthly)', () => {
    const tops = offsetsWithinCard('.plan-price');
    expect(tops.length).toBe(4);
    // One distinct value: every price the same distance down its card. Before
    // the fix this was two values — the badged cards sat 26px lower.
    expect(new Set(tops).size)
      .withContext(`price offsets were ${tops.join(', ')}`)
      .toBe(1);
  });

  it('puts every price at the same height (yearly)', () => {
    comp.billing.set('yearly');
    fixture.detectChanges();

    const tops = offsetsWithinCard('.plan-price');
    expect(new Set(tops).size)
      .withContext(`price offsets were ${tops.join(', ')}`)
      .toBe(1);
  });

  it('keeps the feature lists aligned in yearly view', () => {
    // The free plan has nothing to save, so its savings chip is absent and
    // everything below it would ride up a row without a placeholder.
    comp.billing.set('yearly');
    fixture.detectChanges();

    const tops = offsetsWithinCard('.feature-list');
    expect(tops.length).toBe(4);
    expect(new Set(tops).size)
      .withContext(`feature-list offsets were ${tops.join(', ')}`)
      .toBe(1);
  });

  it('gives every plan the blue-teal gradient CTA', () => {
    const ctas: HTMLElement[] =
      Array.from(fixture.nativeElement.querySelectorAll('.plan-cta'));

    expect(ctas.length).toBe(4);
    for (const cta of ctas) {
      expect(cta.classList.contains('btn-gradient'))
        .withContext(`"${cta.textContent?.trim()}" is not gradient`).toBeTrue();
      expect(cta.classList.contains('btn-outline'))
        .withContext(`"${cta.textContent?.trim()}" is still outlined`).toBeFalse();
    }
  });

  it('hides the placeholders from assistive technology', () => {
    // They exist only to hold a row open; a screen reader must not announce
    // an empty badge on two of the four plans.
    const placeholders: HTMLElement[] =
      Array.from(fixture.nativeElement.querySelectorAll('.is-placeholder'));

    expect(placeholders.length).toBeGreaterThan(0);
    for (const p of placeholders) {
      expect(p.getAttribute('aria-hidden')).toBe('true');
      expect(getComputedStyle(p).visibility).toBe('hidden');
    }
  });
});
