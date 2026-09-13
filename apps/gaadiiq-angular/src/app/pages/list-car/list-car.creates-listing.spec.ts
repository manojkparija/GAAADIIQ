/**
 * Listing a car actually lists it.
 *
 * WHAT WAS REPORTED
 *
 * A car submitted through this form, the success screen reading "Listing
 * Submitted! Your 2010 Maruti Suzuki Ritz has been listed successfully" — and
 * /used-cars reading "0 used cars found".
 *
 * THE CAUSE
 *
 * This form wrote a `cars` row straight to Supabase and stopped. It never
 * created a LISTING. Used Cars renders /listings?listing_type=used, so nothing
 * this form produced could appear there, however correct the row was.
 *
 * The production API log settled it: across the whole submission window there
 * was no POST /listings at all — only POST /valuation/estimate. The request
 * was not failing, it was never being made.
 *
 * The catalogue path could not rescue it either. The third source the app
 * loads is /cars?bucket=new&priced_only=true, and this form deliberately
 * leaves ex_showroom_price NULL for a used advert (a seller's asking price is
 * not the manufacturer's published price), so `priced_only` excluded it
 * server-side before any client filter was reached.
 *
 * WHAT THESE TESTS PIN
 *
 * That the POST happens, that it carries values the API will accept, and that
 * its failure is never dressed up as success — which is the shape of the
 * original bug and the easiest thing to reintroduce.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { ListCarComponent } from './list-car.component';
import { environment } from '../../../environments/environment';

const CAR_ID = '664045d0-e803-4d85-b022-745184cbaac0';

/**
 * A Supabase client that accepts the car row and every follow-up.
 *
 * Only `cars` needs a returned id; car_images and ai_valuation are checked for
 * their error field alone.
 */
function supabaseStub(carsError: any = null) {
  return {
    client: {
      from: (table: string) => ({
        insert: (_rows: any) => {
          const result = { data: null, error: null };
          return {
            select: () => ({
              single: () =>
                Promise.resolve(
                  carsError
                    ? { data: null, error: carsError }
                    : { data: { id: CAR_ID }, error: null },
                ),
            }),
            then: (resolve: any) => resolve(result),
          };
        },
      }),
    },
  };
}

function build(carsError: any = null) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ListCarComponent, RouterTestingModule],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture: ComponentFixture<ListCarComponent> = TestBed.createComponent(ListCarComponent);
  const c = fixture.componentInstance as any;

  // Replace the real Supabase client rather than the service, so nothing here
  // reaches a network or a project key.
  c.sb = supabaseStub(carsError);

  c.form.make = 'Maruti Suzuki';
  c.form.model = 'Ritz';
  c.form.year = 2010;
  c.form.km = '95000';
  c.form.fuel = 'Petrol';
  c.form.transmission = 'Manual';
  c.form.owners = '2nd Owner';
  c.form.condition = 'Good';
  c.form.city = 'Kolkata';
  c.form.price = '140000';
  c.form.phone = '9903411202';
  c.form.email = 'seller@test';

  return { c, http: TestBed.inject(HttpTestingController) };
}

/**
 * Let the awaited Supabase insert resume before looking for the request.
 *
 * onSubmit() awaits the car insert, so the POST is made a microtask later.
 * Calling expectOne() straight after onSubmit() finds nothing and reports it
 * as "no matching request" — which looks exactly like the bug under test.
 */
async function flushMicrotasks(times = 10) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** Answer the listing POST, and return the request that was made. */
async function expectListingPost(http: HttpTestingController) {
  await flushMicrotasks();
  return http.expectOne(`${environment.apiUrl}/listings`);
}

describe('ListCarComponent — the listing actually gets created', () => {
  it('POSTs a listing after the car row is saved', async () => {
    // THE REPORTED GAP. Before this, no such request existed.
    const { c, http } = build();
    const done = c.onSubmit();

    const req = await expectListingPost(http);
    expect(req.request.method).toBe('POST');
    req.flush({ id: 'listing-1' });
    await done;

    http.verify();
  });

  it('sends the car id the Supabase insert returned', async () => {
    const { c, http } = build();
    const done = c.onSubmit();

    const req = await expectListingPost(http);
    expect(req.request.body.car_id).toBe(CAR_ID);
    req.flush({ id: 'listing-1' });
    await done;
  });

  it('files it under the type the seller chose', async () => {
    const { c, http } = build();
    c.listingType.set('used');
    const done = c.onSubmit();

    const req = await expectListingPost(http);
    // Used Cars queries listing_type=used. Anything else here and the car is
    // created but still invisible, which is the original bug wearing a hat.
    expect(req.request.body.listing_type).toBe('used');
    req.flush({ id: 'listing-1' });
    await done;
  });

  it('translates the condition into the grade the API accepts', async () => {
    // THE SILENT 422. This form stores 'Excellent' | 'Good' | 'Fair' |
    // 'Needs Work' — the grades valuation-engine.ts matches on. The API enum
    // is excellent | good | fair | poor, so the stored value passed straight
    // through is rejected on every submission.
    const { c, http } = build();
    c.form.condition = 'Good';
    const done = c.onSubmit();

    const req = await expectListingPost(http);
    expect(req.request.body.condition).toBe('good');
    req.flush({ id: 'listing-1' });
    await done;
  });

  it('maps "Needs Work", which has no counterpart of its own', async () => {
    const { c, http } = build();
    c.form.condition = 'Needs Work';
    const done = c.onSubmit();

    const req = await expectListingPost(http);
    expect(req.request.body.condition).toBe('poor');
    req.flush({ id: 'listing-1' });
    await done;
  });

  it('carries the asking price and odometer', async () => {
    const { c, http } = build();
    const done = c.onSubmit();

    const req = await expectListingPost(http);
    expect(req.request.body.price).toBe(140000);
    expect(req.request.body.km_driven).toBe(95000);
    expect(req.request.body.city).toBe('Kolkata');
    req.flush({ id: 'listing-1' });
    await done;
  });

  it('sends no odometer reading for new stock', async () => {
    // 0 is a reading; the absence of one is null. An advert filed as new does
    // not have to carry one.
    const { c, http } = build();
    c.listingType.set('new');
    c.form.exShowroomPrice = '850000';
    const done = c.onSubmit();

    const req = await expectListingPost(http);
    expect(req.request.body.km_driven).toBeNull();
    expect(req.request.body.price).toBe(850000);
    req.flush({ id: 'listing-1' });
    await done;
  });

  it('goes through HttpClient, so the auth interceptor can sign it', async () => {
    // POST /listings requires get_current_user. The interceptor attaches the
    // Supabase token to HttpClient requests aimed at environment.apiUrl; a
    // fetch() would bypass it and arrive unauthenticated. That this request is
    // visible to HttpTestingController at all is the proof — fetch() never is.
    const { c, http } = build();
    const done = c.onSubmit();

    const req = await expectListingPost(http);
    expect(req.request.url.startsWith(environment.apiUrl)).toBeTrue();
    req.flush({ id: 'listing-1' });
    await done;
  });
});

describe('ListCarComponent — a failed listing is not a success', () => {
  it('does not show the success screen when the listing fails', async () => {
    // THE ONE THAT MATTERS MOST. The reported bug was a green "Listing
    // Submitted!" over a car that was on sale nowhere. Reporting this as a
    // footnote would reproduce it with better wording.
    const { c, http } = build();
    const done = c.onSubmit();

    (await expectListingPost(http)).flush(
      { detail: 'Not authenticated' },
      { status: 401, statusText: 'Unauthorized' },
    );
    await done;

    expect(c.submitted()).toBeFalse();
    expect(c.submitError()).toContain('could not be listed for sale');
    expect(c.loading()).toBeFalse();
  });

  it('shows the reason the API gave', async () => {
    const { c, http } = build();
    const done = c.onSubmit();

    (await expectListingPost(http)).flush(
      { detail: 'Car not found' },
      { status: 404, statusText: 'Not Found' },
    );
    await done;

    expect(c.submitError()).toContain('Car not found');
    expect(c.submitError()).toContain('404');
  });

  it('reuses the committed car row when the seller retries', async () => {
    // Without this, every press of Submit after a failure inserts ANOTHER
    // cars row and orphans the last, quietly filling the catalogue with
    // duplicates of one car.
    const { c, http } = build();

    const first = c.onSubmit();
    (await expectListingPost(http)).flush({}, { status: 500, statusText: 'Server Error' });
    await first;

    const second = c.onSubmit();
    const retry = await expectListingPost(http);
    expect(retry.request.body.car_id).toBe(CAR_ID);
    retry.flush({ id: 'listing-1' });
    await second;
  });

  it('never reaches the listing POST if the car row itself failed', async () => {
    // Nothing to attach a listing to. The existing column-level error is what
    // the seller needs to see here.
    const { c, http } = build({ code: '42703', message: 'column "km" does not exist' });

    await c.onSubmit();
    await flushMicrotasks();

    http.expectNone(`${environment.apiUrl}/listings`);
    expect(c.submitError()).toContain('42703');
  });
});
