import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

/** Minimal mock that resolves login immediately with no error. */
function makeSupabaseMock(overrides: Record<string, unknown> = {}) {
  return {
    client: {
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signInWithPassword: () => Promise.resolve({ error: null }),
        signOut: () => Promise.resolve({ error: null }),
        ...overrides,
      },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
      }),
    },
  };
}

describe('AuthService — AUTH-03: login hydrates before resolve', () => {
  let service: AuthService;
  let supabaseMock: ReturnType<typeof makeSupabaseMock>;

  beforeEach(() => {
    supabaseMock = makeSupabaseMock();

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
      ],
    });

    service = TestBed.inject(AuthService);
  });

  it('currentUser signal is non-null immediately after login() resolves', async () => {
    // Before login: no user
    expect(service.currentUser()).toBeNull();

    await service.login('user@example.com', 'password123');

    // AUTH-03: must be set before the caller gets control back
    expect(service.currentUser()).not.toBeNull();
    expect(service.currentUser()?.email).toBe('user@example.com');
  });

  it('login() throws on bad credentials without setting currentUser', async () => {
    supabaseMock.client.auth.signInWithPassword = () =>
      Promise.resolve({ error: { message: 'Invalid login credentials' } });

    await expectAsync(service.login('bad@example.com', 'wrongpass')).toBeRejected();
    expect(service.currentUser()).toBeNull();
  });
});
