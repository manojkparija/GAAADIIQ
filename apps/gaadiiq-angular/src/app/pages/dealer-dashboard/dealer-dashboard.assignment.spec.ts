/**
 * Handing an enquiry to a dealer.
 *
 * THE SHAPE, AND WHY IT IS NOT A QUEUE
 *
 * The proposal these tests came from parked enquiries in an "unassigned"
 * holding pen and drained it once dealers onboarded. That was considered and
 * deliberately not built.
 *
 * A car enquiry has a shelf life of weeks. Someone asking about an e Vitara in
 * September has bought something by November. Draining a three-month-old queue
 * is not handing over leads — it is asking a new dealer to cold-call people who
 * have moved on, and it begins the dealer relationship with dead numbers.
 *
 * So an admin works every enquiry immediately, and assignment is a transfer of
 * a live lead. `enquiryAgeDays` and `isStaleEnquiry` exist to make the
 * difference visible on the row, so an admin can decline to pass one on. Those
 * are the interesting things to test: an age that quietly reads zero for
 * everything would make the whole distinction decorative while looking fine.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { DealerDashboardComponent } from './dealer-dashboard.component';
import { SupabaseService } from '../../services/supabase.service';

function supabaseStub(result: { data: unknown; error: unknown }) {
  const builder = {
    select: () => builder,
    order: () => Promise.resolve(result),
    eq: () => Promise.resolve(result),
    update: () => builder,
    single: () => Promise.resolve(result),
  };
  return {
    client: {
      from: () => builder,
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
}

function build(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [DealerDashboardComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SupabaseService, useValue: supabaseStub(result) },
    ],
  });
  return TestBed.createComponent(DealerDashboardComponent).componentInstance;
}

/** An ISO timestamp `days` ago. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

describe('DealerDashboardComponent — age of an enquiry', () => {
  it('counts the days a buyer has been waiting', () => {
    const c = build();
    expect(c.enquiryAgeDays(daysAgo(0))).toBe(0);
    expect(c.enquiryAgeDays(daysAgo(5))).toBe(5);
    expect(c.enquiryAgeDays(daysAgo(45))).toBe(45);
  });

  it('flags one old enough to have gone cold', () => {
    // The threshold is a judgement, so the test pins the behaviour either side
    // of it rather than the number itself: something recent is not flagged,
    // something months old is.
    const c = build();
    expect(c.isStaleEnquiry(daysAgo(1)))
      .withContext('a fresh lead must not be discouraged')
      .toBeFalse();
    expect(c.isStaleEnquiry(daysAgo(90)))
      .withContext('three months old, and the buyer has almost certainly bought')
      .toBeTrue();
  });
});

describe('DealerDashboardComponent — assigning a dealer', () => {
  it('does nothing when the dealer has not changed', async () => {
    // Re-selecting the same dealer must not restamp assigned_to_dealer_at,
    // which is the record of when the buyer was actually handed over.
    const c = build();
    c.enquiries.set([
      { id: 'e1', car_id: 'c1', buyer_name: 'A', buyer_phone: '9', buyer_email: null,
        notes: null, created_at: daysAgo(1), assigned_seller_id: 7,
        assigned_to_dealer_at: daysAgo(1) },
    ]);
    const before = c.enquiries()[0].assigned_to_dealer_at;

    await c.assignEnquiry(c.enquiries()[0], '7');

    expect(c.enquiries()[0].assigned_to_dealer_at).toBe(before);
  });

  it('records who it went to, and when', async () => {
    const c = build({ data: [{}], error: null });
    c.enquiries.set([
      { id: 'e1', car_id: 'c1', buyer_name: 'A', buyer_phone: '9', buyer_email: null,
        notes: null, created_at: daysAgo(1), assigned_seller_id: null,
        assigned_to_dealer_at: null },
    ]);

    await c.assignEnquiry(c.enquiries()[0], '7');

    expect(c.enquiries()[0].assigned_seller_id).toBe(7);
    expect(c.enquiries()[0].assigned_to_dealer_at)
      .withContext('when a buyer was handed over is the thing being recorded')
      .toBeTruthy();
  });

  it('clears the timestamp when a lead is taken back', async () => {
    // Unassigning is not an assignment. Leaving the stamp would say a dealer
    // still holds a lead that has been withdrawn from them.
    const c = build({ data: [{}], error: null });
    c.enquiries.set([
      { id: 'e1', car_id: 'c1', buyer_name: 'A', buyer_phone: '9', buyer_email: null,
        notes: null, created_at: daysAgo(1), assigned_seller_id: 7,
        assigned_to_dealer_at: daysAgo(1) },
    ]);

    await c.assignEnquiry(c.enquiries()[0], '');

    expect(c.enquiries()[0].assigned_seller_id).toBeNull();
    expect(c.enquiries()[0].assigned_to_dealer_at).toBeNull();
  });

  it('puts the row back when the write is refused', async () => {
    // Row-level security refuses by returning an error, and an optimistic row
    // that silently keeps a failed assignment tells an admin a dealer has a
    // lead they were never given.
    const c = build({ data: null, error: { message: 'permission denied' } });
    c.enquiries.set([
      { id: 'e1', car_id: 'c1', buyer_name: 'A', buyer_phone: '9', buyer_email: null,
        notes: null, created_at: daysAgo(1), assigned_seller_id: null,
        assigned_to_dealer_at: null },
    ]);

    await c.assignEnquiry(c.enquiries()[0], '7');

    expect(c.enquiries()[0].assigned_seller_id).toBeNull();
    expect(c.enquiryStatusError()).toBe('e1');
  });
});
