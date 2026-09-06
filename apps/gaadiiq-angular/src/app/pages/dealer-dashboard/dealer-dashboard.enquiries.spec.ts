/**
 * The Enquiries tab distinguishes "none" from "not allowed to look".
 *
 * WHAT THIS PREVENTS COMING BACK
 *
 * Buyers' enquiries were being recorded and the dashboard reported, with
 * confidence, that nobody had sent any. Two independent faults produced the
 * same empty list:
 *
 * 1. `car_enquiries` had row-level security enabled and one policy, for
 *    INSERT. Postgres default-denies, so every SELECT returned zero rows —
 *    to dealers and admins alike. Fixed in 024 by adding a read policy.
 *
 * 2. For a non-admin, loadEnquiries first fetched that seller's rows from
 *    `car_listings`, a table that does not exist. The query returned null,
 *    the id list came out empty, and the method returned before it ever asked
 *    about enquiries. Removed: the scoping now lives in the database, where
 *    it can actually be enforced — the anon key ships in the browser bundle,
 *    so a filter applied in TypeScript is advisory at best, and these rows
 *    carry a buyer's name, phone number and email.
 *
 * What made both survivable for so long is that the query result was
 * destructured as `{ data }`, discarding `error`. A refused read then renders
 * identically to an empty inbox. These tests pin the difference.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { DealerDashboardComponent } from './dealer-dashboard.component';
import { SupabaseService } from '../../services/supabase.service';

/**
 * A Supabase client stub whose table reads end in the given result.
 *
 * `auth` is present because AuthService reads the session in its own
 * constructor, and this component injects it — without these two the
 * component cannot be built at all, and the failure looks like a bug in the
 * test rather than a missing stub.
 */
function supabaseReturning(result: { data: unknown; error: unknown }) {
  const builder = {
    select: () => builder,
    order: () => Promise.resolve(result),
    eq: () => builder,
    in: () => builder,
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

describe('DealerDashboardComponent — the Enquiries tab', () => {
  function build(result: { data: unknown; error: unknown }): DealerDashboardComponent {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [DealerDashboardComponent, RouterTestingModule],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: SupabaseService, useValue: supabaseReturning(result) },
      ],
    });
    return TestBed.createComponent(DealerDashboardComponent).componentInstance;
  }

  it('shows the reason when the database refuses the read', async () => {
    // The exact shape of fault 1: RLS declines, Supabase returns an error and
    // no rows. Reporting this as "no enquiries yet" is the bug.
    const c = build({
      data: null,
      error: { message: 'permission denied for table car_enquiries', code: '42501' },
    });

    await (c as unknown as { loadEnquiries(): Promise<void> }).loadEnquiries();

    expect(c.enquiriesError())
      .withContext('a refused read must not be reported as an empty inbox')
      .toContain('permission denied');
    expect(c.enquiries().length).toBe(0);
  });

  it('reports nothing when the inbox is genuinely empty', async () => {
    // The other half. A real empty result must not raise a false alarm, or
    // the error state becomes noise and gets ignored.
    const c = build({ data: [], error: null });

    await (c as unknown as { loadEnquiries(): Promise<void> }).loadEnquiries();

    expect(c.enquiriesError()).toBe('');
    expect(c.enquiries().length).toBe(0);
  });

  it('clears a previous error once a read succeeds', async () => {
    // Otherwise the first failure sticks to the screen for the rest of the
    // session and the tab looks broken after it has recovered.
    const c = build({ data: [{ id: '1', car_id: 'c1', buyer_name: 'A', buyer_phone: '9', buyer_email: null, notes: null, created_at: '2026-01-01' }], error: null });
    c.enquiriesError.set('something earlier went wrong');

    await (c as unknown as { loadEnquiries(): Promise<void> }).loadEnquiries();

    expect(c.enquiriesError()).toBe('');
    expect(c.enquiries().length).toBe(1);
  });
});
