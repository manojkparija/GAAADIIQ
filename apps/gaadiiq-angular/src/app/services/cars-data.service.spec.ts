import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { CarsDataService, describeFailure } from './cars-data.service';
import { environment } from '../../environments/environment';

/**
 * Match a catalogue request by its URL apart from the cache-busting parameter.
 *
 * fetchOrNull appends `&_=<timestamp>` to every request so no cache between the
 * page and the origin can hold a copy — see the comment there. That makes the
 * exact URL unpredictable, so these specs match on the part that is stable.
 */
function expectCall(http: HttpTestingController, url: string) {
  return http.expectOne(req => req.url.split('&_=')[0].split('?_=')[0] === url);
}


/**
 * The catalogue is assembled from three independent sources: new listings,
 * used listings, and the manufacturer catalogue that admin-uploaded
 * photography lands in.
 *
 * They were fetched with Promise.all, which rejects as soon as any one of them
 * does. When /listings started failing — its table in the deployed database
 * was missing the price column — the catalogue call succeeded and its result
 * was thrown away with the rest, so the New Cars pages showed "0 models
 * available" for cars that were priced, photographed and ready to sell.
 *
 * A source that fails should cost only its own rows.
 */
const CATALOGUE_CAR = {
  id: '11111111-1111-1111-1111-111111111111',
  make: 'Maruti Suzuki',
  model: 'Dzire',
  variant: 'ZXi',
  year: new Date().getFullYear(),
  fuel_type: 'petrol',
  transmission: 'manual',
  body_type: 'sedan',
  ex_showroom_price: 899000,
  image_urls: ['https://example.test/dzire.webp'],
};

describe('CarsDataService — one failing source', () => {
  let http: HttpTestingController;

  const urls = {
    // page=1 is explicit now: the catalogue is fetched page by page, because
    // the API caps a page at 100 and a longer catalogue was silently truncated.
    new: `${environment.apiUrl}/listings?listing_type=new&page=1&page_size=100`,
    used: `${environment.apiUrl}/listings?listing_type=used&page=1&page_size=100`,
    catalogue: `${environment.apiUrl}/cars?bucket=new&priced_only=true&page=1&page_size=100`,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Answer one round of fetches: both listings calls fail, the catalogue answers. */
  function answerRound(): void {
    const failed = { status: 500, statusText: 'Internal Server Error' };
    const error = { detail: 'column listings.price does not exist' };

    expectCall(http, urls.new).flush(error, failed);
    expectCall(http, urls.used).flush(error, failed);
    expectCall(http, urls.catalogue).flush({
      items: [CATALOGUE_CAR],
      total: 1,
      page: 1,
      page_size: 100,
    });
  }

  it('keeps catalogue cars when /listings fails', async () => {
    // The service loads in its constructor, so injecting it starts a round.
    const svc = TestBed.inject(CarsDataService);
    answerRound();

    // reload returns the promise the constructor's load does not expose, which
    // is what makes the result awaitable.
    const reloaded = svc.reload();
    answerRound();
    await reloaded;

    expect(svc.getAll().find(c => c.model === 'Dzire'))
      .withContext('a priced catalogue model must survive a listings outage')
      .toBeTruthy();
  });
});

/**
 * An advert may replace a catalogue model on the New Cars pages, but only if
 * the advert is itself shown there.
 *
 * The pages display a car with no odometer reading. A listing filed under
 * listing_type=new need not have one — a seller can advertise a driven car as
 * new. Such a row was filtered off the page and still claimed its model's
 * identity, so the catalogue entry it stood for was suppressed too: no advert,
 * no catalogue model, and no explanation anywhere.
 */
describe('CarsDataService — an advert that is not shown must not hide a model', () => {
  let http: HttpTestingController;

  const urls = {
    new: `${environment.apiUrl}/listings?listing_type=new&page=1&page_size=100`,
    used: `${environment.apiUrl}/listings?listing_type=used&page=1&page_size=100`,
    catalogue: `${environment.apiUrl}/cars?bucket=new&priced_only=true&page=1&page_size=100`,
  };

  const listingFor = (over: Record<string, unknown>) => ({
    id: '22222222-2222-2222-2222-222222222222',
    price: 850000,
    km_driven: 0,
    listing_type: 'new',
    image_urls: [],
    car: {
      make: CATALOGUE_CAR.make,
      model: CATALOGUE_CAR.model,
      variant: CATALOGUE_CAR.variant,
      year: CATALOGUE_CAR.year,
      fuel_type: 'petrol',
    },
    ...over,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function answerRound(newListings: unknown[]): void {
    const page = (items: unknown[]) => ({ items, total: items.length, page: 1, page_size: 100 });
    expectCall(http, urls.new).flush(page(newListings));
    expectCall(http, urls.used).flush(page([]));
    expectCall(http, urls.catalogue).flush(page([CATALOGUE_CAR]));
  }

  async function loadWith(newListings: unknown[]): Promise<CarsDataService> {
    const svc = TestBed.inject(CarsDataService);
    answerRound(newListings);
    const reloaded = svc.reload();
    answerRound(newListings);
    await reloaded;
    return svc;
  }

  it('keeps the catalogue model when the advert has an odometer reading', async () => {
    const svc = await loadWith([listingFor({ km_driven: 34000 })]);

    const shown = svc.getAll().filter(c => c.model === 'Dzire' && c.km === 0);
    expect(shown.length)
      .withContext('a driven advert filed as new must not hide the model')
      .toBe(1);
  });

  it('still lets a genuine new advert replace the catalogue model', async () => {
    const svc = await loadWith([listingFor({})]);

    const dzires = svc.getAll().filter(c => c.model === 'Dzire');
    expect(dzires.length).withContext('the same car must not appear twice').toBe(1);
    expect(dzires[0].price).withContext('the advert wins, at its own price').toBe(850000);
  });
});

/**
 * Every catalogue request carries a key no cache can already hold.
 *
 * REPORTED ALL DAY, AND STILL AFTER FOUR OTHER FIXES
 *
 * "0 models available" on a normal reload; the full catalogue after a hard
 * refresh; every time. A hard refresh differs from a normal one in exactly one
 * way — it sends `Cache-Control: no-cache` and so skips every cache between
 * the page and the origin.
 *
 * Each cache was examined and cleared of blame by reading the code: the API
 * stamps no-store on any request carrying Authorization and the reporter is
 * signed in; the service worker's compiled patterns never match `/cars?...`;
 * Vary: Origin is set on everything cacheable. The symptom outlived all of it.
 *
 * The busting parameter stops that argument: a URL unique per request cannot
 * be answered from a stored copy by anything. It is blunt and it costs the
 * edge cache on catalogue reads, which is why it needs a test saying so — a
 * future reader tidying away a stray `_=` timestamp would restore the bug
 * without ever seeing it.
 */
describe('CarsDataService — cache busting', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    http = TestBed.inject(HttpTestingController);
  });

  it('appends a unique parameter to every catalogue request', () => {
    TestBed.inject(CarsDataService);

    const requests = http.match(() => true);
    expect(requests.length).withContext('the constructor should have started a load').toBeGreaterThan(0);

    for (const req of requests) {
      expect(req.request.url)
        .withContext('a request without a busting parameter can be served from a cache')
        .toMatch(/[?&]_=\d+/);
      req.flush({ items: [], total: 0, page: 1, page_size: 100 });
    }
  });

  it('does not lose the query the caller asked for', () => {
    // The parameter is appended, never substituted. bucket and priced_only are
    // what keep unpriced rows and used-car photography off the New Cars pages,
    // so dropping them would be a far worse bug than the one being fixed.
    TestBed.inject(CarsDataService);

    const catalogue = http.match(req => req.url.includes('/cars?'));
    expect(catalogue.length).toBe(1);
    expect(catalogue[0].request.url).toContain('bucket=new');
    expect(catalogue[0].request.url).toContain('priced_only=true');
    expect(catalogue[0].request.url).toContain('page_size=100');

    for (const req of http.match(() => true)) {
      req.flush({ items: [], total: 0, page: 1, page_size: 100 });
    }
  });
});

/**
 * The failure reason shown on screen.
 *
 * WHY THIS IS WORTH TESTING
 *
 * This string is the diagnostic instrument for a fault that six attempts
 * failed to fix — every one of them reasoned about which layer was at fault
 * because nobody had the actual error. If the text is wrong or empty, the next
 * report is another guess.
 *
 * It is also the one place where "no response at all" must not be described as
 * something more specific. Angular reports status 0 for a network failure, a
 * CORS rejection and a request that never left the browser, and the browser
 * withholds which — so the text has to say that honestly rather than pick one.
 */
describe('describeFailure', () => {
  const URL_UNDER_TEST = 'https://api.gaadiiq.com/cars?bucket=new&page=1&_=1735689600000';

  it('names the path without the host or the cache-busting parameter', () => {
    // The timestamp is noise in a bug report and would differ on every line.
    const text = describeFailure(URL_UNDER_TEST, new HttpErrorResponse({ status: 500 }));
    expect(text).toContain('/cars?bucket=new&page=1');
    expect(text).not.toContain('_=');
    expect(text).not.toContain('api.gaadiiq.com');
  });

  it('says plainly that a status 0 could be several things', () => {
    // The whole point. Naming one of them would be a guess presented as a
    // finding, which is exactly the failure mode this exists to end.
    const text = describeFailure(URL_UNDER_TEST, new HttpErrorResponse({ status: 0 }));
    expect(text).toContain('no response');
    expect(text).toContain('CORS');
  });

  it('carries the status and the API detail when the server answered', () => {
    const text = describeFailure(
      URL_UNDER_TEST,
      new HttpErrorResponse({ status: 503, error: { detail: 'database is starting up' } }),
    );
    expect(text).toContain('503');
    expect(text).toContain('database is starting up');
  });

  it('survives an error that is not an HttpErrorResponse', () => {
    // getSession() rejecting produced a plain Error, not an HTTP one, and a
    // describer that assumed otherwise would print "undefined" for the case
    // most likely to matter.
    expect(describeFailure(URL_UNDER_TEST, new Error('Auth session missing')))
      .toContain('Auth session missing');
  });
});
