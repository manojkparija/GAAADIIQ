/**
 * The Overview tab counts, rather than asserts.
 *
 * WHAT WAS THERE
 *
 * Six headline cards, assigned once at construction and never touched again
 * — `metrics` had exactly one occurrence in the whole component, its own
 * declaration:
 *
 *   Total Listings 24 · Profile Views 1,248 · Enquiries 87 ·
 *   Test Drive Requests "—" / "Loading…" · Avg. Days to Sell 18 ·
 *   Revenue (MTD) ₹14.2L "+24% vs last month"
 *
 * They sat on the Overview while the tabs beside them read Test Drives 1 and
 * Enquiries 2, so the page contradicted itself on screen. The fourth card is
 * the tell: it said "Loading…" permanently, because nothing ever loaded it.
 *
 * Below them, "Recent Leads" listed six invented buyers — Arjun Mehta, Priya
 * Nair, Ravi Kumar and three more — each with a budget band, an intent score
 * and a DIALABLE PHONE NUMBER. That is the same shape as the fabricated
 * dealer removed in #235, except a dealer reading this page would have had
 * every reason to ring one.
 *
 * THE ONE THAT WAS EASIEST TO MISS
 *
 * The AI Lead Intelligence chips read
 * `sentimentSummary()?.grade_a ?? countGrade('A')`, and countGrade counted
 * that same invented list. So whenever the sentiment service had nothing to
 * say — a new dealer, a failed call — the panel reported an AI grading of
 * customers who did not exist, in a component whose real grading works fine.
 * A fallback that fabricates is worse than no fallback: it fires exactly when
 * there is no data, which is exactly when it will be believed.
 *
 * WHAT COULD NOT BE COUNTED
 *
 * Three of the six cards are removed rather than approximated, because
 * nothing records them: profile views (no counter exists), average days to
 * sell (a listing has a created date and a status, but no sold-at, so the
 * interval cannot be computed even in principle), and revenue (the dealer's
 * sales are not in this database at all). Revenue was the most believable
 * figure on the page and the one with the least behind it.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { signal } from '@angular/core';
import { DealerDashboardComponent } from './dealer-dashboard.component';
import { SupabaseService } from '../../services/supabase.service';
import { MyListingsService } from '../../services/my-listings.service';

function supabaseStub() {
  const builder = {
    select: () => builder,
    order: () => Promise.resolve({ data: [], error: null }),
    eq: () => Promise.resolve({ data: [], error: null }),
    update: () => builder,
    single: () => Promise.resolve({ data: null, error: null }),
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

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function listing(over: Partial<any> = {}): any {
  return {
    id: 'l1', make: 'Maruti Suzuki', model: 'Swift', variant: 'VXi', year: 2022,
    km: 20000, fuel: 'Petrol', transmission: 'Manual', owners: '1',
    color: 'White', city: 'Rourkela', price: 600000, description: '',
    bodyType: 'Hatchback', name: '', phone: '', email: '',
    status: 'live', createdAt: daysAgo(2), supabaseId: 'sb-1',
    ...over,
  };
}

function enquiry(over: Partial<any> = {}): any {
  return {
    id: 'e1', car_id: 'sb-1', buyer_name: 'A Buyer', buyer_phone: '9000000000',
    buyer_email: null, notes: null, created_at: daysAgo(1),
    status: 'new', assigned_seller_id: null, assigned_to_dealer_at: null,
    ...over,
  };
}

function build(listings: any[] = []) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [DealerDashboardComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SupabaseService, useValue: supabaseStub() },
      {
        provide: MyListingsService,
        useValue: { listings: signal(listings), loading: signal(false) },
      },
    ],
  });
  return TestBed.createComponent(DealerDashboardComponent).componentInstance;
}

describe('DealerDashboardComponent — the headline metrics', () => {
  it('reports zeros on an empty account, not 24 listings and ₹14.2L', () => {
    // The state a newly onboarded dealer sees. The old cards claimed a
    // business that did not exist before they had listed a single car.
    const c = build();
    c.enquiries.set([]);

    const values = c.metrics().map(m => m.value);
    expect(values).toEqual(['0', '0', '0']);
  });

  it('counts listings, enquiries and test drives from real data', () => {
    const c = build([
      listing({ id: 'a', supabaseId: 'a' }),
      listing({ id: 'b', supabaseId: 'b' }),
    ]);
    c.enquiries.set([enquiry({ id: '1' }), enquiry({ id: '2' }), enquiry({ id: '3' })]);

    const by = (label: string) => c.metrics().find(m => m.label === label);
    expect(by('Live Listings')?.value).toBe('2');
    expect(by('Enquiries')?.value).toBe('3');
    expect(by('Test Drive Requests')?.value).toBe('0');
  });

  it('describes this week from real dates, not "+18% vs last week"', () => {
    const c = build([
      listing({ id: 'a', supabaseId: 'a', createdAt: daysAgo(2) }),
      listing({ id: 'b', supabaseId: 'b', createdAt: daysAgo(40) }),
    ]);
    c.enquiries.set([]);

    expect(c.metrics().find(m => m.label === 'Live Listings')?.change).toBe('+1 this week');
    expect(c.metrics().find(m => m.label === 'Enquiries')?.change).toBe('none this week');
  });

  it('no longer claims views, days-to-sell or revenue', () => {
    // None of the three has a source. Revenue is the one that matters most:
    // it was the most believable number on the page.
    const c = build([listing()]);
    const labels = c.metrics().map(m => m.label).join(' ');

    expect(labels).not.toContain('Profile Views');
    expect(labels).not.toContain('Days to Sell');
    expect(labels).not.toContain('Revenue');
  });

  it('never leaves a card saying "Loading…"', () => {
    // The old Test Drive card said that permanently — nothing assigned it.
    const c = build();
    c.enquiries.set([]);
    expect(c.metrics().map(m => m.change).join(' ')).not.toContain('Loading');
  });
});

describe('DealerDashboardComponent — the Recent Leads preview', () => {
  it('is empty rather than populated with invented buyers', () => {
    const c = build();
    c.enquiries.set([]);
    expect(c.recentEnquiries()).toEqual([]);
  });

  it('shows real enquiries, newest first, capped at four', () => {
    const c = build([listing({ supabaseId: 'sb-1', make: 'Maruti Suzuki', model: 'Swift' })]);
    c.enquiries.set([
      enquiry({ id: '1', buyer_name: 'Oldest', created_at: daysAgo(9) }),
      enquiry({ id: '2', buyer_name: 'Newest', created_at: daysAgo(1) }),
      enquiry({ id: '3', buyer_name: 'Middle', created_at: daysAgo(4) }),
      enquiry({ id: '4', buyer_name: 'Fourth', created_at: daysAgo(6) }),
      enquiry({ id: '5', buyer_name: 'Older still', created_at: daysAgo(7) }),
    ]);

    const rows = c.recentEnquiries();
    expect(rows.length).toBe(4);
    expect(rows.map(r => r.name)).toEqual(['Newest', 'Middle', 'Fourth', 'Older still']);
    expect(rows.map(r => r.name))
      .withContext('the oldest of the five is the one that falls off')
      .not.toContain('Oldest');
  });

  it('names the dealer’s own car, and admits when it cannot', () => {
    // car_enquiries.car_id holds either a listings.id or a cars.id and the
    // column cannot tell them apart. An enquiry against catalogue stock is
    // not this dealer's car, so it says so instead of guessing.
    const c = build([listing({ supabaseId: 'sb-1', make: 'Maruti Suzuki', model: 'Swift' })]);
    c.enquiries.set([
      enquiry({ id: '1', car_id: 'sb-1' }),
      enquiry({ id: '2', car_id: 'some-catalogue-uuid' }),
    ]);

    const cars = c.recentEnquiries().map(r => r.car);
    expect(cars).toContain('Maruti Suzuki Swift');
    expect(cars).toContain('—');
  });
});

describe('DealerDashboardComponent — most enquired models', () => {
  it('renders nothing rather than inventing view counts', () => {
    const c = build([listing()]);
    c.enquiries.set([]);
    expect(c.enquiredModels()).toEqual([]);
  });

  it('ranks the dealer’s cars by enquiries actually received', () => {
    const c = build([
      listing({ id: 'a', supabaseId: 'a', model: 'Swift' }),
      listing({ id: 'b', supabaseId: 'b', model: 'Baleno' }),
    ]);
    c.enquiries.set([
      enquiry({ id: '1', car_id: 'b' }),
      enquiry({ id: '2', car_id: 'b' }),
      enquiry({ id: '3', car_id: 'a' }),
    ]);

    const ranked = c.enquiredModels();
    expect(ranked[0]).toEqual({ model: 'Maruti Suzuki Baleno', enquiries: 2 });
    expect(ranked[1]).toEqual({ model: 'Maruti Suzuki Swift', enquiries: 1 });
  });
});

describe('DealerDashboardComponent — the AI grade chips', () => {
  it('falls back to zero, not to a grading of people who do not exist', () => {
    // The chips read `sentimentSummary()?.grade_a ?? countGrade('A')`, and
    // countGrade counted the six invented buyers — so with no sentiment data
    // the panel reported an AI grading of nobody. This is the fallback path,
    // which fires exactly when there is nothing to report.
    const c = build();

    expect(c.countGrade('A')).toBe(0);
    expect(c.countGrade('B')).toBe(0);
    expect(c.countGrade('C')).toBe(0);
    expect(c.countGrade('D')).toBe(0);
  });
});
