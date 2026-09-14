/**
 * Changing the asking price changes the price buyers see.
 *
 * WHAT WAS WRONG
 *
 * updatePrice wrote `cars.price` straight through Supabase:
 *
 *     this.sb.client.from('cars').update({ price }).eq('id', listing.supabaseId)
 *
 * Two faults, and the first one alone made the feature a no-op:
 *
 *   - /used-cars renders `listing.price`. The column being written was not the
 *     one anyone reads, so a seller dropped their price, saw the new figure on
 *     their own page — that part is local state — and buyers went on seeing
 *     the old one. Nothing errored.
 *
 *   - Once used adverts began sharing one catalogue row per model, that write
 *     lands on a row belonging to EVERY seller of that model. One seller
 *     editing their asking price would be writing into shared catalogue data.
 *
 * It is PATCH /listings/{id} now — the endpoint that already exists for this,
 * already checks the listing belongs to the caller, and already fires the
 * price-drop alerts that a direct table write skipped entirely.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';

import { MyListingsService, MyListing } from './my-listings.service';
import { AuthService } from './auth.service';
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

function build(item: MyListing) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { currentUser: signal(null) } },
    ],
  });
  const svc = TestBed.inject(MyListingsService);
  svc.listings.set([item]);
  return { svc, http: TestBed.inject(HttpTestingController) };
}

async function flush(times = 10) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('MyListingsService — changing the asking price', () => {
  afterEach(() => localStorage.removeItem('gaadiiq_my_listings'));

  it('patches the listing, which is what buyers read', async () => {
    const { svc, http } = build(entry({ listingId: LISTING_ID }));

    const done = svc.updatePrice('local-1', 99000);
    await flush();

    const req = http.expectOne(`${environment.apiUrl}/listings/${LISTING_ID}`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ price: 99000 });
    req.flush({ id: LISTING_ID, price: 99000 });
    await done;

    expect(svc.listings()[0].price).toBe(99000);
  });

  it('never writes to the catalogue row', async () => {
    // THE ONE THAT MATTERS MOST. That row is shared by every seller of the
    // model now; one seller's asking price has no business on it.
    const { svc, http } = build(entry({ listingId: LISTING_ID }));

    const done = svc.updatePrice('local-1', 99000);
    await flush();
    http.expectOne(`${environment.apiUrl}/listings/${LISTING_ID}`)
      .flush({ id: LISTING_ID, price: 99000 });
    await done;

    // No request to anything car-shaped, and no Supabase client to reach for.
    http.verify();
    expect((svc as any).sb).toBeUndefined();
  });

  it('finds the listing id for an entry created before it was stored', async () => {
    const { svc, http } = build(entry({ listingId: null }));

    const done = svc.updatePrice('local-1', 99000);
    await flush();

    http.expectOne(`${environment.apiUrl}/listings/me?page=1&page_size=100`)
      .flush({ items: [{ id: LISTING_ID, car: { id: CAR_ID } }] });
    await flush();

    const req = http.expectOne(`${environment.apiUrl}/listings/${LISTING_ID}`);
    expect(req.request.method).toBe('PATCH');
    req.flush({ id: LISTING_ID, price: 99000 });
    await done;

    expect(svc.listings()[0].price).toBe(99000);
  });

  it('surfaces a refusal rather than showing a price the server rejected', async () => {
    // The failure mode this whole service kept repeating: a local number that
    // does not match the server's, with nothing said.
    const { svc, http } = build(entry({ listingId: LISTING_ID }));

    const done = svc.updatePrice('local-1', 99000);
    await flush();
    http.expectOne(`${environment.apiUrl}/listings/${LISTING_ID}`)
      .flush({ detail: 'Not your listing' }, { status: 403, statusText: 'Forbidden' });

    await expectAsync(done).toBeRejected();
    expect(svc.listings()[0].price)
      .withContext('the old price stands until the server accepts the new one')
      .toBe(110000);
  });
});
