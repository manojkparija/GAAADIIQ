/**
 * Removing a listing actually takes it off the market.
 *
 * WHAT WAS WRONG
 *
 * remove() deleted the CAR row:
 *
 *     this.sb.client.from('cars').delete().eq('id', listing.supabaseId)
 *       .then(() => {});
 *
 * That worked while a sold car was only a `cars` row. It stopped the moment
 * the sell form began creating real listings: `listings.car_id` is
 * ForeignKey("cars.id") with no ondelete, so Postgres defaults to NO ACTION
 * and refuses to delete a car an advert points at.
 *
 * And the result was discarded — `.then(() => {})` takes no error argument —
 * so the refusal went nowhere. The row vanished from My Listings, the advert
 * stayed live on /used-cars, and nothing anywhere said so. A seller who had
 * sold their car could not take it off the market, and had no way to find out.
 *
 * WHAT THESE PIN
 *
 * That the LISTING is what gets withdrawn, that an advert with no stored
 * listing id is still found, and — most of all — that a failure is not
 * swallowed. The last one is why this file exists: every other assertion here
 * would pass on a version that quietly did nothing.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';

import { MyListingsService, MyListing } from './my-listings.service';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { environment } from '../../environments/environment';

const CAR_ID = '664045d0-e803-4d85-b022-745184cbaac0';
const LISTING_ID = 'aa11bb22-cc33-dd44-ee55-ff6677889900';

function entry(over: Partial<MyListing> = {}): MyListing {
  return {
    id: 'local-1', make: 'Maruti Suzuki', model: 'Ritz', variant: '',
    year: 2010, km: 95000, fuel: 'Petrol', transmission: 'Manual',
    owners: '2nd Owner', color: '', city: 'Kolkata', price: 110000,
    description: '', bodyType: 'Hatchback', name: '', phone: '', email: '',
    status: 'live', createdAt: new Date().toISOString(),
    supabaseId: CAR_ID,
    ...over,
  };
}

/** Records whether the legacy `cars` delete was attempted. */
function supabaseStub(deleteError: any = null) {
  const calls: string[] = [];
  return {
    calls,
    client: {
      from: (table: string) => ({
        delete: () => ({
          eq: (_col: string, id: string) => {
            calls.push(`${table}:${id}`);
            return Promise.resolve({ error: deleteError });
          },
        }),
      }),
    },
  };
}

function build(item: MyListing, deleteError: any = null) {
  TestBed.resetTestingModule();
  const sb = supabaseStub(deleteError);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      // currentUser() is read by an effect in the constructor; a null user
      // keeps it from firing a Supabase sync during these tests.
      { provide: AuthService, useValue: { currentUser: signal(null) } },
      { provide: SupabaseService, useValue: sb },
    ],
  });
  const svc = TestBed.inject(MyListingsService);
  svc.listings.set([item]);
  return { svc, sb, http: TestBed.inject(HttpTestingController) };
}

async function flush(times = 10) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('MyListingsService — removing an advert', () => {
  afterEach(() => localStorage.removeItem('gaadiiq_my_listings'));

  it('deactivates the listing through the API', async () => {
    // THE FIX. DELETE /listings/{id} is the endpoint built for this — a soft
    // delete setting is_active = false, which is what /used-cars filters on.
    const { svc, http } = build(entry({ listingId: LISTING_ID }));

    const done = svc.remove('local-1');
    await flush();

    const req = http.expectOne(`${environment.apiUrl}/listings/${LISTING_ID}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await done;

    expect(svc.listings().length).toBe(0);
  });

  it('leaves the car row alone when there is a listing to withdraw', async () => {
    // The car is the catalogue entry the photographs hang off. Withdrawing an
    // advert is not deleting the model — and the database refuses it anyway.
    const { svc, sb, http } = build(entry({ listingId: LISTING_ID }));

    const done = svc.remove('local-1');
    await flush();
    http.expectOne(`${environment.apiUrl}/listings/${LISTING_ID}`)
      .flush(null, { status: 204, statusText: 'No Content' });
    await done;

    expect(sb.calls).toEqual([]);
  });

  it('finds the listing id for an advert created before it was stored', async () => {
    // Every entry placed between the sell form learning to create listings and
    // this being written knows only its car id. That includes the first advert
    // the flow ever produced.
    const { svc, http } = build(entry({ listingId: null }));

    const done = svc.remove('local-1');
    await flush();

    const lookup = http.expectOne(
      `${environment.apiUrl}/listings/me?page=1&page_size=100`,
    );
    expect(lookup.request.method).toBe('GET');
    lookup.flush({ items: [{ id: LISTING_ID, car: { id: CAR_ID } }] });
    await flush();

    http.expectOne(`${environment.apiUrl}/listings/${LISTING_ID}`)
      .flush(null, { status: 204, statusText: 'No Content' });
    await done;

    expect(svc.listings().length).toBe(0);
  });

  it('does not withdraw somebody else’s advert on a near match', async () => {
    // Matching on car id, not on make and model. Two sellers with the same
    // model must not be able to take each other's adverts down — and since
    // used adverts started sharing one catalogue row per model, they now
    // genuinely do have the same car id in common.
    const { svc, sb, http } = build(entry({ listingId: null }));

    const done = svc.remove('local-1');
    await flush();
    http.expectOne(`${environment.apiUrl}/listings/me?page=1&page_size=100`)
      .flush({ items: [{ id: 'other-listing', car: { id: 'a-different-car' } }] });
    await flush();

    http.expectNone(`${environment.apiUrl}/listings/other-listing`);
    await done;
    // And no car row is touched either. See the next block.
    expect(sb.calls).toEqual([]);
  });
});

describe('MyListingsService — a seller never deletes a catalogue row', () => {
  afterEach(() => localStorage.removeItem('gaadiiq_my_listings'));

  /**
   * THE ROOT CAUSE, PINNED.
   *
   * Remove used to fall back to deleting the CAR row through Supabase when it
   * could not find a listing. That is the wrong table and the wrong owner: a
   * catalogue row describes the MODEL, and since used adverts began sharing
   * one, deleting it would take every other seller's car with it. The database
   * refuses (listings.car_id is NOT NULL with no ON DELETE), so what the
   * seller actually got was an error about a table they never meant to touch,
   * for an advert the server had already forgotten.
   *
   * Pressing Remove now does exactly one thing: withdraw the listing. When
   * there is no listing, there is nothing on the server to withdraw, and
   * dropping the local row IS the removal.
   */
  it('drops a local entry the server has no advert for, touching nothing else', async () => {
    const { svc, sb, http } = build(entry({ listingId: null, supabaseId: CAR_ID }));

    const done = svc.remove('local-1');
    await flush();
    http.expectOne(`${environment.apiUrl}/listings/me?page=1&page_size=100`)
      .flush({ items: [] });
    await done;

    expect(sb.calls)
      .withContext('a seller pressing Remove must never delete a catalogue row')
      .toEqual([]);
    expect(svc.listings().length).toBe(0);
    http.verify();
  });

  it('removes it even when the listing lookup fails outright', async () => {
    // An outage must not leave a seller stuck with an entry they cannot clear.
    // There is no advert to strand: one that reached the server has its id
    // stored, and this branch is only for entries that never did.
    const { svc, sb, http } = build(entry({ listingId: null, supabaseId: CAR_ID }));

    const done = svc.remove('local-1');
    await flush();
    http.expectOne(`${environment.apiUrl}/listings/me?page=1&page_size=100`)
      .error(new ProgressEvent('network'));
    await done;

    expect(sb.calls).toEqual([]);
    expect(svc.listings().length).toBe(0);
  });
});

describe('MyListingsService — a failed removal is not hidden', () => {
  afterEach(() => localStorage.removeItem('gaadiiq_my_listings'));

  it('throws when the API refuses, and keeps the entry on the list', async () => {
    // THE ONE THAT MATTERS MOST. The old code discarded this and removed the
    // row locally regardless, so the seller saw success and buyers kept seeing
    // the car.
    const { svc, http } = build(entry({ listingId: LISTING_ID }));

    const done = svc.remove('local-1');
    await flush();
    http.expectOne(`${environment.apiUrl}/listings/${LISTING_ID}`)
      .flush({ detail: 'Not your listing' }, { status: 403, statusText: 'Forbidden' });

    await expectAsync(done).toBeRejected();
    expect(svc.listings().length)
      .withContext('an advert that is still live must stay on this page')
      .toBe(1);
  });

  it('treats a 404 as already gone, not as a failure', async () => {
    /**
     * REPORTED, with a screenshot: "Could not remove this listing (404):
     * Listing not found. It is still visible to buyers."
     *
     * On an advert that had just been deleted along with its catalogue row —
     * so it was visible to nobody. My Listings held a stale entry pointing at
     * a listing id the server no longer has, every Remove returned 404, the
     * card could not be cleared, and the message said the opposite of the
     * truth.
     *
     * A 404 means the server has no such advert. That IS the state being
     * asked for.
     */
    const { svc, http } = build(entry({ listingId: LISTING_ID }));

    const done = svc.remove('local-1');
    await flush();
    http.expectOne(`${environment.apiUrl}/listings/${LISTING_ID}`)
      .flush({ detail: 'Listing not found' }, { status: 404, statusText: 'Not Found' });

    await expectAsync(done).toBeResolved();
    expect(svc.listings().length).toBe(0);
  });

  it('still throws on a refusal that is not a 404', async () => {
    // The distinction the 404 handling must not blur: 403 means the advert is
    // there and the seller may not touch it. Clearing the card on that would
    // be the original bug, back again.
    const { svc, http } = build(entry({ listingId: LISTING_ID }));

    const done = svc.remove('local-1');
    await flush();
    http.expectOne(`${environment.apiUrl}/listings/${LISTING_ID}`)
      .flush({ detail: 'Not your listing' }, { status: 403, statusText: 'Forbidden' });

    await expectAsync(done).toBeRejected();
    expect(svc.listings().length).toBe(1);
  });

  it('still throws when the network fails', async () => {
    // An unreachable API is not evidence the advert is gone.
    const { svc, http } = build(entry({ listingId: LISTING_ID }));

    const done = svc.remove('local-1');
    await flush();
    http.expectOne(`${environment.apiUrl}/listings/${LISTING_ID}`)
      .error(new ProgressEvent('network'));

    await expectAsync(done).toBeRejected();
    expect(svc.listings().length).toBe(1);
  });

  it('still removes an entry that has no car and no listing', async () => {
    // A purely local draft. Nothing to call, nothing to fail.
    const { svc } = build(entry({ listingId: null, supabaseId: null }));

    await svc.remove('local-1');

    expect(svc.listings().length).toBe(0);
  });
});
