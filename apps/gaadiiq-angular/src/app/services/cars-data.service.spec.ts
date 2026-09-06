import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { CarsDataService, describeFailure, isWorthRetrying, FETCH_ATTEMPTS } from './cars-data.service';
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

/**
 * The outage panel always says something.
 *
 * REPORTED FROM THE LIVE SITE, IMMEDIATELY AFTER THE REASON SHIPPED
 *
 * "Could not load the car catalogue" rendered with the reason line blank. The
 * first version only recorded failures inside fetchOrNull, and load()'s catch
 * marks all three sources failed without touching it.
 *
 * That blank line was itself a finding. The catch runs for ANY error raised in
 * load(), not only the deliberate "every catalogue source failed" throw — an
 * exception while MAPPING a response lands there too, long after the requests
 * came back healthy. Render's logs showed every request returning 200 OK
 * during the failures, so a load really can fail with nothing wrong on the
 * wire, and the panel has to be able to say so.
 */
describe('CarsDataService — the outage panel always has a reason', () => {
  let http: HttpTestingController;
  let svc: CarsDataService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    http = TestBed.inject(HttpTestingController);
    svc = TestBed.inject(CarsDataService);
  });

  /** Answer every in-flight request with `body`. */
  function answerAll(body: unknown) {
    for (const req of http.match(() => true)) req.flush(body as object);
  }

  it('reports a reason when every source fails', async () => {
    // 500, not 503, and the distinction is now load-bearing. This test is
    // about a source that has definitively failed, so it needs a status the
    // service treats as a final answer. 503 became retryable when the 504 on
    // the live site showed that gateway statuses say nothing about the next
    // attempt — so flushing one here now leaves two retries in flight and this
    // test hung rather than failing, which is a worse way to find out.
    const reloaded = svc.reload();
    for (const req of http.match(() => true)) {
      req.flush({ detail: 'boom' }, { status: 500, statusText: 'Internal Server Error' });
    }
    await reloaded;

    expect(svc.failedSources().length).withContext('this is the outage state').toBeGreaterThan(0);
    expect(svc.lastFailure()).withContext('the panel would render blank').not.toBe('');
    expect(svc.lastFailure()).toContain('500');
  });

  it('reports a reason when the requests succeed but the load throws', async () => {
    // The case the first version missed, and the one the evidence points at:
    // 200 OK on the wire, and the failure afterwards. `items` as a non-array
    // makes the mapping throw the way malformed data would.
    const reloaded = svc.reload();
    answerAll({ items: 'not-an-array', total: 1, page: 1, page_size: 100 });
    await reloaded;

    expect(svc.failedSources().length).toBeGreaterThan(0);
    expect(svc.lastFailure())
      .withContext('a load that fails after a 200 must still name itself')
      .not.toBe('');
  });
});

/**
 * A gateway timeout is retried; a real answer is not.
 *
 * WHAT THIS PREVENTS COMING BACK
 *
 * The catalogue failed on the live site with the panel reading:
 *
 *     /cars?bucket=new&priced_only=true&page=1&page_size=100
 *       — HTTP 504 Gateway Timeout
 *
 * The retry loop was there, and it did not fire. It retried `status === 0`
 * only, on the reasoning that a response — even a 500 — is a real answer from
 * a reachable API and asking again just makes a broken endpoint slower to
 * report. That reasoning is right for a 500 and wrong for a 504: a 504 is the
 * gateway giving up on the API and answering in its place, so it says nothing
 * about what the next attempt will do. The fault is intermittent and the next
 * attempt usually succeeds — but the page had already given up and drawn an
 * outage panel for a service that was about to answer.
 *
 * These tests hold both halves. Widening the retry set is only safe while the
 * second one passes.
 */
describe('CarsDataService — which failures are worth asking again', () => {
  it('retries a 504 rather than showing an outage panel for it', () => {
    expect(isWorthRetrying(new HttpErrorResponse({ status: 504 })))
      .withContext('the exact status the live site returned')
      .toBeTrue();
  });

  it('retries the other gateway statuses, which mean the same thing', () => {
    expect(isWorthRetrying(new HttpErrorResponse({ status: 502 }))).toBeTrue();
    // 503 is also what the API itself returns when a database call exceeds
    // its timeout, so this is the client half of that pair.
    expect(isWorthRetrying(new HttpErrorResponse({ status: 503 }))).toBeTrue();
  });

  it('still retries when nothing answered at all', () => {
    expect(isWorthRetrying(new HttpErrorResponse({ status: 0 }))).toBeTrue();
  });

  it('does not retry a considered answer from the API', () => {
    // The half that keeps the widening honest. A 500, a 404 and a 422 are the
    // server having looked at the request; asking twice more only delays the
    // report and hides a real bug behind three identical failures.
    for (const status of [400, 404, 422, 500]) {
      expect(isWorthRetrying(new HttpErrorResponse({ status })))
        .withContext(`HTTP ${status} is the API answering, not a gateway giving up`)
        .toBeFalse();
    }
  });

  it('does not retry something that is not an HTTP failure at all', () => {
    expect(isWorthRetrying(new Error('Auth session missing'))).toBeFalse();
  });
});

/**
 * The predicate above, actually wired into the fetch loop.
 *
 * Worth testing separately from `isWorthRetrying`: a correct predicate that
 * nothing calls looks exactly like a working retry. The original bug was not a
 * wrong predicate, it was a retry loop that ran for one status and not the one
 * the live site produced.
 */
describe('CarsDataService — a gateway timeout end to end', () => {
  let http: HttpTestingController;
  let svc: CarsDataService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    http = TestBed.inject(HttpTestingController);
    svc = TestBed.inject(CarsDataService);
  });

  /**
   * Answer every request currently in flight, across all three sources.
   *
   * The service loads /cars and both /listings buckets together, so a test
   * that answers only the one it cares about leaves the others hanging — which
   * surfaces as a five-second Jasmine timeout rather than a failed assertion,
   * and is a much worse way to find out.
   */
  function answerAll(body: unknown, opts?: { status: number; statusText: string }) {
    for (const req of http.match(() => true)) {
      opts ? req.flush(body as string, opts) : req.flush(body as object);
    }
  }

  const TIMED_OUT = { status: 504, statusText: 'Gateway Timeout' };

  it('recovers the catalogue when the first attempt times out at the gateway', async () => {
    // The whole point of the change: one 504 must not become an outage panel
    // for a service that answers on the very next attempt.
    const reloaded = svc.reload();

    answerAll('gateway timeout', TIMED_OUT);
    await new Promise(resolve => setTimeout(resolve, 300));

    // Each source answered in its own shape. Flushing one catalogue body to
    // all three makes the listings mapper read `make` off an undefined row and
    // throw, which the panel then reports as a failure — a green retry that
    // still ends in an error message, for reasons that have nothing to do with
    // retrying.
    const page = { total: 0, page: 1, page_size: 100 };
    for (const req of http.match(() => true)) {
      req.flush(
        req.request.url.includes('/cars')
          ? {
              ...page,
              total: 1,
              items: [
                {
                  id: '1',
                  make: 'Maruti Suzuki',
                  model: 'Swift',
                  year: 2025,
                  ex_showroom_price: 899000,
                },
              ],
            }
          : { ...page, items: [] },
      );
    }
    await reloaded;

    expect(svc.cars().length)
      .withContext('the retry succeeded, so the reader should have cars')
      .toBeGreaterThan(0);
    expect(svc.lastFailure())
      .withContext('a retry that succeeded must not leave a failure on screen')
      .toBe('');
  });

  it('still names the failure when every retry times out too', async () => {
    // The other side of it. A 504 that persists must end in a panel that says
    // 504 — retrying must not swallow the reason, which is the single thing
    // that made this fault diagnosable after six wrong guesses.
    const reloaded = svc.reload();

    for (let round = 0; round < FETCH_ATTEMPTS; round++) {
      answerAll('gateway timeout', TIMED_OUT);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    await reloaded;

    expect(svc.lastFailure())
      .withContext('three timeouts and the panel would render blank')
      .toContain('504');
  });
});
