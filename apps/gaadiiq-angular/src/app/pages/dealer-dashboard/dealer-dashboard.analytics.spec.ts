/**
 * The Analytics tab reports this dealer's data, not a fixed script.
 *
 * WHAT WAS REPORTED
 *
 * A screenshot of the Analytics tab circling two Market Intelligence cards:
 * "the market intelligence is static, it should not be static". It was — four
 * paragraphs of prose typed into the template, identical for every dealer on
 * every day, under a page subtitled "Real-time insights into your listings,
 * leads, and revenue performance":
 *
 *   "SUVs in Bangalore are trending 4.2% above national average this week."
 *   "Electric vehicle searches up 34% in your city."
 *   "Your response time (avg 22 min) is in the top 15% of dealers."
 *   "Listings posted Thursday-Friday see 28% more views over the weekend."
 *
 * The Fuel Mix chart directly above them was the same: a fixed 42/28/18/8/4
 * split, drawn even for a dealer with nothing listed.
 *
 * THE PART THAT IS NOT ABOUT STALENESS
 *
 * Two of those cards make claims about the reader. Nothing in this system
 * records when a dealer first replied to an enquiry, so "avg 22 min" was not
 * a stale measurement — it was never a measurement. "Top 15% of dealers" ranks
 * them against a peer group that currently has four members. And a dealer in
 * Rourkela was being told what SUVs are doing in Bangalore.
 *
 * So the fix is not "make these update". Two of the four have no honest
 * version and are gone rather than approximated:
 *
 *   - Response time would need a first_responded_at stamp that does not exist
 *     and cannot be back-computed.
 *   - Best time to list would need views bucketed by weekday. Listing views
 *     are not recorded per day anywhere.
 *
 * That is the same rule the rest of the codebase already follows:
 * credit_bureau.fetch_score raises rather than returning a plausible score,
 * and the car page says "Price not announced yet" rather than ₹0.
 *
 * WHY THE EMPTY CASES ARE TESTED FIRST
 *
 * A dashboard that invents figures and one that computes them look identical
 * on a populated account. The difference only shows on an empty one — which is
 * exactly the state a newly onboarded dealer sees, and the state in which the
 * old panel was most confidently wrong.
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

/** An ISO timestamp `days` ago. */
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
    id: 'e1', car_id: 'c1', buyer_name: 'A Buyer', buyer_phone: '9000000000',
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

describe('DealerDashboardComponent — Fuel Mix', () => {
  it('shows nothing rather than a stock split when there are no listings', () => {
    // The old chart drew Petrol 42% for a dealer with no cars at all.
    expect(build().fuelMix()).toEqual([]);
  });

  it('counts the dealer’s own stock', () => {
    const c = build([
      listing({ id: 'a', supabaseId: 'a', fuel: 'Petrol' }),
      listing({ id: 'b', supabaseId: 'b', fuel: 'Petrol' }),
      listing({ id: 'c', supabaseId: 'c', fuel: 'Electric' }),
      listing({ id: 'd', supabaseId: 'd', fuel: 'Diesel' }),
    ]);

    const mix = c.fuelMix();
    expect(mix.length).toBe(3);
    // Largest first, so the chart reads top to bottom.
    expect(mix[0]).toEqual(jasmine.objectContaining({ label: 'Petrol', pct: 50, count: 2 }));
    expect(mix.find(f => f.label === 'Electric')?.pct).toBe(25);
    expect(mix.find(f => f.label === 'Diesel')?.pct).toBe(25);
  });

  it('keeps a fuel the colour map has never heard of', () => {
    // A fuel type nobody anticipated must appear, not vanish into a chart that
    // then does not add up.
    const c = build([listing({ fuel: 'Hydrogen' })]);
    expect(c.fuelMix()[0]).toEqual(
      jasmine.objectContaining({ label: 'Hydrogen', pct: 100 }),
    );
  });

  it('does not drop a listing whose fuel was never entered', () => {
    const c = build([listing({ fuel: '' })]);
    expect(c.fuelMix()[0].label).toBe('Not stated');
  });
});

describe('DealerDashboardComponent — Market Intelligence', () => {
  it('says nothing at all on an empty account', () => {
    // The state a newly onboarded dealer sees, and where the old panel was
    // most confidently wrong — it told them about Bangalore SUV pricing and
    // their own 22-minute response time before they had listed a single car.
    const c = build();
    c.enquiries.set([]);

    expect(c.marketIntel())
      .withContext('nothing measured means nothing claimed')
      .toEqual([]);
  });

  it('counts enquiries actually received, this month against last', () => {
    const c = build();
    c.enquiries.set([
      enquiry({ id: '1', created_at: daysAgo(3) }),
      enquiry({ id: '2', created_at: daysAgo(10) }),
      enquiry({ id: '3', created_at: daysAgo(45) }),
    ]);

    const card = c.marketIntel().find(k => k.title === 'Enquiries this month');
    expect(card).withContext('two in the last 30 days, one before').toBeTruthy();
    expect(card!.detail).toContain('2 enquiries in the last 30 days');
    expect(card!.detail).toContain('against 1');
  });

  it('surfaces what is waiting on the dealer', () => {
    const c = build();
    c.enquiries.set([
      enquiry({ id: '1', status: 'new' }),
      enquiry({ id: '2', status: 'contacted' }),
    ]);

    const card = c.marketIntel().find(k => k.title === 'Waiting on you');
    expect(card).toBeTruthy();
    expect(card!.detail).toContain('1 enquiry not yet worked');
  });

  it('reports ageing stock from each listing’s own date', () => {
    const c = build([
      listing({ id: 'a', supabaseId: 'a', createdAt: daysAgo(2) }),
      listing({ id: 'b', supabaseId: 'b', createdAt: daysAgo(75), model: 'Baleno' }),
    ]);

    const card = c.marketIntel().find(k => k.title === 'Ageing stock');
    expect(card).toBeTruthy();
    expect(card!.detail).toContain('1 of your 2 listings');
    expect(card!.detail)
      .withContext('names the actual oldest car, not a generic nudge')
      .toContain('Baleno');
  });

  it('does not flag ageing stock when nothing is old', () => {
    const c = build([listing({ createdAt: daysAgo(3) })]);
    expect(c.marketIntel().find(k => k.title === 'Ageing stock')).toBeUndefined();
  });

  it('describes the dealer’s own price band, not a national average', () => {
    // Deliberately not "4.2% above the national average": this dashboard holds
    // one dealer's listings, so a national comparison would be a number
    // invented to fill the card.
    const c = build([
      listing({ id: 'a', supabaseId: 'a', price: 400000 }),
      listing({ id: 'b', supabaseId: 'b', price: 600000 }),
      listing({ id: 'c', supabaseId: 'c', price: 1200000 }),
    ]);

    const card = c.marketIntel().find(k => k.title === 'Your price band');
    expect(card).toBeTruthy();
    expect(card!.detail).toContain('₹4.00L');
    expect(card!.detail).toContain('₹12.00L');
    expect(card!.detail).toContain('median ₹6.00L');
  });

  it('needs more than one price before it describes a band', () => {
    const c = build([listing({ price: 500000 })]);
    expect(c.marketIntel().find(k => k.title === 'Your price band')).toBeUndefined();
  });

  it('never claims a response time or a ranking against other dealers', () => {
    // The two cards with no honest version. Nothing records when a dealer
    // first replied, and the peer group has four members. If either phrase
    // reappears, it was invented again.
    const c = build([listing({ createdAt: daysAgo(90) })]);
    c.enquiries.set([enquiry()]);

    const text = c.marketIntel().map(k => `${k.title} ${k.detail}`).join(' ');
    expect(text).not.toContain('response time');
    expect(text).not.toContain('top 15%');
    expect(text).not.toContain('Bangalore');
    expect(text).not.toMatch(/\bsearches up\b/);
  });
});
