/**
 * The "Full Feature Comparison" table lists every feature the plans differ on.
 *
 * WHY THIS SPEC EXISTS
 *
 * AI Diagnosis shipped gated and rationed, the plan cards were updated to say
 * so, and this table was missed — so the page showed the cap in one section and
 * omitted the feature entirely in the section headed "Full Feature Comparison"
 * two screens below. Reported by the user, from the rendered page, after the
 * change had been called done twice.
 *
 * The table is a hardcoded array in the template, unlike the cards above it,
 * which come from `subscription_plans.features` in Supabase. That difference is
 * exactly why it was missed: updating the plan data does nothing here.
 *
 * WHAT THIS CAN AND CANNOT GUARD
 *
 * It pins the row's presence and its four values, so the row cannot be deleted
 * or quietly edited without a red test.
 *
 * It CANNOT check those numbers against the thing that enforces them —
 * `MONTHLY_QUOTA` in apps/api/services/diagnosis_quota.py — because that is
 * Python, nor against the plan cards, because those live in a database no test
 * can reach. Three copies of one set of numbers, one of which is authoritative.
 * If the quota changes, all three change together:
 *
 *   1. apps/api/services/diagnosis_quota.py          (the enforcer)
 *   2. supabase/migrations/*_plan_features_*.sql     (the cards, run by hand)
 *   3. this table                                    (pinned below)
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { PricingPlansComponent } from './pricing-plans.component';
import { SubscriptionService } from '../../services/subscription.service';
import { AnalyticsService } from '../../services/analytics.service';
import { AuthService } from '../../services/auth.service';

describe('pricing plans — full feature comparison table', () => {
  let fixture: ComponentFixture<PricingPlansComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PricingPlansComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        {
          provide: SubscriptionService,
          useValue: {
            // Empty on purpose. This table is hardcoded in the template, so it
            // renders with no plan data at all — which is the point being made.
            plans: signal([]),
            loading: signal(false),
            displayPrice: () => 0,
          },
        },
        { provide: AnalyticsService, useValue: { track: () => {} } },
        { provide: AuthService, useValue: { currentUser: signal(null), isAdmin: () => false } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PricingPlansComponent);
    fixture.detectChanges();
  });

  /** The four plan cells of the comparison row whose label is `feature`. */
  function row(feature: string): string[] | null {
    const rows: HTMLElement[] =
      Array.from(fixture.nativeElement.querySelectorAll('.ct-row'));
    const found = rows.find(
      r => r.querySelector('.ct-feature')?.textContent?.trim() === feature,
    );
    if (!found) return null;
    return Array.from(found.querySelectorAll('span'))
      .slice(1)                       // drop the feature label itself
      .map(s => (s.textContent ?? '').trim());
  }

  it('lists AI Diagnosis at all', () => {
    // The bug this spec was written for: the row was simply absent.
    expect(row('AI Diagnosis')).withContext('no AI Diagnosis row').not.toBeNull();
  });

  it('states each plan\'s AI Diagnosis allowance, matching the API quota', () => {
    // Free / Buyer Pro / Seller / Dealer Pro, in the header's column order.
    // These mirror MONTHLY_QUOTA in apps/api/services/diagnosis_quota.py:
    // free 3, pro unlimited, seller_basic 10, dealer unlimited.
    expect(row('AI Diagnosis')).toEqual(['3/month', 'Unlimited', '10/month', 'Unlimited']);
  });

  it('does not mark AI Diagnosis unavailable on any plan', () => {
    // Every plan gets some allowance — anonymous is the only blocked caller,
    // and anonymous is not a plan. A "❌" in this row would contradict both
    // the cards and the API.
    expect(row('AI Diagnosis')).not.toContain('❌');
  });

  it('keeps the row in the same column order as the table header', () => {
    // The header and the rows are separate markup, so a column added to one
    // and not the other would shift every value silently. Anchored on a row
    // that predates this change and is unambiguous per column.
    const head: string[] = Array.from(
      fixture.nativeElement.querySelectorAll('.ct-head span'),
    ).map((s: any) => (s.textContent ?? '').trim());
    expect(head).toEqual(['Feature', 'Free', 'Buyer Pro', 'Seller', 'Dealer Pro']);
    expect(row('List vehicles')).toEqual(['❌', '❌', '3 cars', 'Unlimited']);
  });
});
