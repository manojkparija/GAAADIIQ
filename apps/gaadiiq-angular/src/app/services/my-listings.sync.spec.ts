/**
 * My Listings shows what the server says the seller has — no more.
 *
 * REPORTED, with a screenshot: a 2026 Swift stayed on My Listings after its
 * advert had been deleted along with its catalogue row. Every Remove answered
 * 404, because there was nothing left to withdraw, and the card could not be
 * cleared.
 *
 * TWO FAULTS IN THE MERGE
 *
 *   1. It kept every local entry the server did not return. That reads as
 *      "be generous, do not lose the seller's data" and is the opposite: an
 *      entry carrying a listingId IS a server record, so the server not
 *      listing it means the advert is gone.
 *
 *   2. It required `data.length > 0` before merging at all, so a seller who
 *      removed their LAST advert kept it forever — the server said "you have
 *      none" and the code treated that as nothing to do.
 *
 * An empty list is an answer. Only an error or a timeout means "do not touch
 * what is stored", and that distinction is what the last two tests pin.
 */
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';

import { MyListingsService, MyListing } from './my-listings.service';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

const STORAGE_KEY = 'gaadiiq_my_listings';
const ME = `${environment.apiUrl}/listings/me?page=1&page_size=100`;

function entry(over: Partial<MyListing> = {}): MyListing {
  return {
    id: 'local-1', make: 'Maruti Suzuki', model: 'Swift', variant: '',
    year: 2026, km: 0, fuel: 'petrol', transmission: 'manual',
    owners: '', color: '', city: 'Kolkata', price: 584000,
    description: '', bodyType: 'Hatchback', name: '', phone: '',
    email: 'seller@example.com', status: 'live',
    createdAt: new Date().toISOString(),
    ...over,
  };
}

/** Stores entries, then signs a user in so the sync effect fires. */
function build(stored: MyListing[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  TestBed.resetTestingModule();
  const user = signal<any>(null);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { currentUser: user } },
    ],
  });
  const svc = TestBed.inject(MyListingsService);
  const http = TestBed.inject(HttpTestingController);
  user.set({ email: 'seller@example.com', name: 'Seller' });
  TestBed.flushEffects();
  return { svc, http };
}

describe('MyListingsService — what the sync keeps', () => {
  afterEach(() => localStorage.removeItem(STORAGE_KEY));

  it('drops an advert the server no longer lists', fakeAsync(() => {
    // THE REPORTED BUG. The listing was deleted with its catalogue row.
    const { svc, http } = build([entry({ listingId: 'listing-gone' })]);

    http.expectOne(ME).flush({ items: [{ id: 'listing-other', car: { id: 'car-2' }, price: 110000 }] });
    tick();

    expect(svc.listings().some(l => l.listingId === 'listing-gone')).toBeFalse();
    tick(6000);   // drain the service's 5s timeout race
  }));

  it('empties the list when the seller has no adverts left', fakeAsync(() => {
    // The second fault: an empty response used to be skipped entirely.
    const { svc, http } = build([entry({ listingId: 'listing-gone' })]);

    http.expectOne(ME).flush({ items: [] });
    tick();

    expect(svc.listings()).toEqual([]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')).toEqual([]);
    tick(6000);
  }));

  it('keeps a local draft that never reached the server', fakeAsync(() => {
    // No listingId: nothing on the server contradicts it.
    const { svc, http } = build([entry({ id: 'draft-1', listingId: null })]);

    http.expectOne(ME).flush({ items: [] });
    tick();

    expect(svc.listings().length).toBe(1);
    expect(svc.listings()[0].id).toBe('draft-1');
    tick(6000);
  }));

  it('shows each advert once, not twice', fakeAsync(() => {
    // The stored copy and the server's copy are the same advert.
    const { svc, http } = build([entry({ listingId: 'listing-1', supabaseId: 'car-1' })]);

    http.expectOne(ME).flush({
      items: [{ id: 'listing-1', car: { id: 'car-1', make: 'Maruti Suzuki', model: 'Swift' }, price: 584000 }],
    });
    tick();

    expect(svc.listings().length).toBe(1);
    tick(6000);
  }));

  it('keeps everything when the server cannot be reached', fakeAsync(() => {
    // THE ONE THAT MATTERS MOST. An outage must not look like "you have no
    // adverts" and wipe the seller's page.
    const { svc, http } = build([entry({ listingId: 'listing-1' })]);

    http.expectOne(ME).error(new ProgressEvent('network'));
    tick();

    expect(svc.listings().length).toBe(1);
    tick(6000);
  }));

  it('keeps everything when the request times out', fakeAsync(() => {
    const { svc, http } = build([entry({ listingId: 'listing-1' })]);

    http.expectOne(ME);   // never answered
    tick(6000);           // past the 5s timeout

    expect(svc.listings().length).toBe(1);
    tick();
  }));
});
