/**
 * The dealer's side of the lead flow.
 *
 * The list call takes no city parameter and that is the point: scope comes
 * from the caller's own dealer record on the server, so a client cannot ask
 * for another city's buyers by editing a query string. Asserted here because
 * adding one later would look like a harmless convenience.
 */
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { LeadService, CarLead } from './lead.service';
import { environment } from '../../environments/environment';

function lead(over: Partial<CarLead> = {}): CarLead {
  return {
    id: 'l1', make: 'Maruti Suzuki', model: 'Fronx', variant: null,
    city: 'Kolkata', locality: 'Salt Lake', pincode: '700091',
    phone: '+919876543210', phone_verified: true,
    name: 'A Buyer', email: null, consented_at: '2026-08-22T00:00:00Z',
    source: 'offers_cta', status: 'new', created_at: '2026-08-22T00:00:00Z',
    ...over,
  };
}

describe('LeadService', () => {
  let svc: LeadService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    svc = TestBed.inject(LeadService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('normalises the numbers people actually type', () => {
    expect(LeadService.toE164('9876543210')).toBe('+919876543210');
    expect(LeadService.toE164('98765 43210')).toBe('+919876543210');
    expect(LeadService.toE164('+91 98765 43210')).toBe('+919876543210');
    expect(LeadService.toE164('09876543210')).toBe('+919876543210');
  });

  it('rejects numbers the API would reject anyway', () => {
    // Indian mobiles start 6-9; saying so here saves a wasted SMS.
    expect(LeadService.toE164('1234567890')).toBeNull();
    expect(LeadService.toE164('98765')).toBeNull();
    expect(LeadService.toE164('')).toBeNull();
  });

  it('asks for the inbox without naming a city', async () => {
    const pending = svc.list();
    const req = http.expectOne(`${environment.apiUrl}/leads`);

    expect(req.request.method).toBe('GET');
    // No city, no dealer id: the server decides the scope.
    expect(req.request.urlWithParams).toBe(`${environment.apiUrl}/leads`);

    req.flush([lead()]);
    expect((await pending).length).toBe(1);
  });

  it('patches only the status', async () => {
    const pending = svc.setStatus('l1', 'contacted');
    const req = http.expectOne(`${environment.apiUrl}/leads/l1`);

    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'contacted' });

    req.flush(lead({ status: 'contacted' }));
    expect((await pending).status).toBe('contacted');
  });

  it('sets no Authorization header of its own', () => {
    // auth.interceptor attaches the Supabase token to anything aimed at
    // environment.apiUrl; setting one here would shadow it (CLAUDE.md).
    svc.list();
    const req = http.expectOne(`${environment.apiUrl}/leads`);
    expect(req.request.headers.has('Authorization')).toBeFalse();
    req.flush([]);
  });
});
