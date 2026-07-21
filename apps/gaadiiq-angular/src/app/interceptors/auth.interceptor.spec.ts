import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';
import { SupabaseService } from '../services/supabase.service';

const API_URL = 'http://localhost:8000';

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

  it('attaches Bearer header when session token present', async () => {
    setup('test-jwt-token');
    http.get(`${API_URL}/cars`).subscribe();

    const req = httpMock.expectOne(`${API_URL}/cars`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer test-jwt-token');
    req.flush([]);
  });

  it('does not attach header when no session', async () => {
    setup(null);
    http.get(`${API_URL}/cars`).subscribe();

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
