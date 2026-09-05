import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';
import { SupabaseService } from '../services/supabase.service';
import { environment } from '../../environments/environment';

// Must track the real config: the interceptor only touches URLs under
// environment.apiUrl, so a hardcoded value here silently tests nothing.
const API_URL = environment.apiUrl;

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  const mockSupabaseWithToken = (token: string | null) => ({
    client: {
      auth: {
        getSession: () => Promise.resolve({ data: { session: token ? { access_token: token } : null } }),
      },
    },
  });

  /** A Supabase client whose getSession() rejects, as it can at boot. */
  const mockSupabaseThatThrows = () => ({
    client: {
      auth: {
        getSession: () => Promise.reject(new Error('Auth session missing')),
      },
    },
  });

  function setupWith(supabase: unknown) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: SupabaseService, useValue: supabase },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  }

  function setup(token: string | null) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: SupabaseService, useValue: mockSupabaseWithToken(token) },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  }

  afterEach(() => httpMock.verify());

  /**
   * The interceptor awaits supabase.auth.getSession() before dispatching, so
   * the request only reaches HttpTestingController after the microtask queue
   * drains. Without this, expectOne runs too early and finds nothing.
   */
  const flushMicrotasks = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  it('attaches Bearer header when session token present', async () => {
    setup('test-jwt-token');
    http.get(`${API_URL}/cars`).subscribe();
    await flushMicrotasks();

    const req = httpMock.expectOne(`${API_URL}/cars`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer test-jwt-token');
    req.flush([]);
  });

  it('does not attach header when no session', async () => {
    setup(null);
    http.get(`${API_URL}/cars`).subscribe();
    await flushMicrotasks();

    const req = httpMock.expectOne(`${API_URL}/cars`);
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush([]);
  });

  it('does not intercept non-API URLs', async () => {
    setup('test-token');
    http.get('https://external.example.com/data').subscribe();

    const req = httpMock.expectOne('https://external.example.com/data');
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush({});
  });
});


/**
 * A session that cannot be read must not take the request with it.
 *
 * REPORTED FROM THE LIVE SITE, FOR MOST OF A DAY
 *
 * "0 models available" on a normal reload; the full catalogue after a hard
 * refresh; every time. The API was healthy throughout — the exact URLs the app
 * calls returned the whole catalogue when opened in a browser tab — and the
 * responses were uncached in both directions, because a request carrying
 * Authorization is stamped `no-store` by core/cache_policy.py.
 *
 * The failure was in this interceptor. `getSession()` is asynchronous, reads
 * storage, and refreshes an expired token over the network. Nothing caught its
 * rejection, so the observable errored and `next(req)` was never reached — the
 * request was not sent at all. Every API call in the app passes through here,
 * and CarsDataService loads the catalogue from its constructor, the earliest
 * and raciest moment in the app's life.
 *
 * A normal reload serves the bundles from cache and boots fast, so it lost that
 * race; a hard refresh re-downloads them, so the session was ready in time.
 * That is the whole of "why do I need to hard refresh every time".
 */
describe('authInterceptor — when the session cannot be read', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        {
          provide: SupabaseService,
          useValue: {
            client: { auth: { getSession: () => Promise.reject(new Error('Auth session missing')) } },
          },
        },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  it('still sends the request', async () => {
    // The whole bug in one assertion. Before the fix this expectOne found
    // nothing, because the request never left the interceptor.
    let failed: unknown = null;
    http.get(`${API_URL}/cars`).subscribe({ error: e => (failed = e) });
    await flush();

    const req = httpMock.expectOne(`${API_URL}/cars`);
    req.flush({ items: [] });
    await flush();
    expect(failed).toBeNull();
  });

  it('sends it without an Authorization header rather than forging one', async () => {
    // Failing open drops the header; it never invents one. A public endpoint
    // answers as it would for any signed-out visitor, and a protected one
    // returns 401 — which is exactly what an unreadable session means.
    http.get(`${API_URL}/cars`).subscribe();
    await flush();

    const req = httpMock.expectOne(`${API_URL}/cars`);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({ items: [] });
  });
});
