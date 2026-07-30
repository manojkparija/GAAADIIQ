import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';
import { environment } from '../../environments/environment';

/** Minimal mock that resolves login immediately with no error. */
function makeSupabaseMock(overrides: Record<string, unknown> = {}) {
  return {
    client: {
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        // Typed loosely so individual tests can override with an error result.
        // Takes the credentials so tests can assert which password was sent.
        signInWithPassword: (_creds?: any): Promise<{ error: any }> => Promise.resolve({ error: null }),
        signOut: (): Promise<{ error: any }> => Promise.resolve({ error: null }),
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

describe('AuthService — the dev shortcut must not hijack a real sign-in', () => {
  let service: AuthService;
  let supabaseMock: ReturnType<typeof makeSupabaseMock>;
  let sentPasswords: string[];

  beforeEach(() => {
    sentPasswords = [];
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

  /**
   * The regression this guards: the shortcut was checked before Supabase and
   * only matched the hardcoded password, so it sent THAT password upstream.
   * The admin's real password was never tried, Supabase answered "Invalid login
   * credentials" to something the user had not typed, and the session degraded
   * to browser-only with no token — every upload then failed.
   */
  it('sends the password the user actually typed, not the shortcut password', async () => {
    supabaseMock.client.auth.signInWithPassword = (creds: any) => {
      sentPasswords.push(creds.password);
      return Promise.resolve({ error: null });
    };

    await service.login(environment.devAdminEmail, 'my-real-supabase-password');

    expect(sentPasswords).toEqual(['my-real-supabase-password']);
    expect(service.isLocalOnly()).toBeFalse();
  });

  it('a real sign-in wins even when the shortcut password is used', async () => {
    supabaseMock.client.auth.signInWithPassword = () => Promise.resolve({ error: null });

    await service.login(environment.devAdminEmail, 'admin123');

    expect(service.isLocalOnly()).toBeFalse();
    expect(service.localOnlyReason()).toBeNull();
  });

  it('falls back to a local-only session only after Supabase refuses', async () => {
    supabaseMock.client.auth.signInWithPassword = () =>
      Promise.resolve({ error: { message: 'Email not confirmed' } });

    await service.login(environment.devAdminEmail, 'admin123');

    expect(service.isLocalOnly()).toBeTrue();
    // The banner must show Supabase's own words: an unconfirmed email and a
    // wrong password land in the same place but need different fixes.
    expect(service.localOnlyReason()).toBe('Email not confirmed');
  });

  it('a wrong real password for the admin email throws instead of degrading', async () => {
    supabaseMock.client.auth.signInWithPassword = () =>
      Promise.resolve({ error: { message: 'Invalid login credentials' } });

    await expectAsync(service.login(environment.devAdminEmail, 'not-the-shortcut')).toBeRejected();
    expect(service.currentUser()).toBeNull();
  });
});

describe('AuthService — admin emails keep the admin screens reachable', () => {
  /**
   * Second half of the same bug. Once the real sign-in works, the role comes
   * from `user_profiles`; a genuine admin with no row there was demoted to
   * 'user' and the ingestion page disappeared — login fixed, page lost.
   */
  it('grants admin when the email is allowlisted but no profile row exists', async () => {
    const supabaseMock = makeSupabaseMock();
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
      ],
    });
    const service = TestBed.inject(AuthService);

    // `from()` already resolves every lookup to { data: null } — no profile,
    // no seller row.
    await service.login(environment.adminEmails[0], 'real-password');

    expect(service.isAdmin()).toBeTrue();
  });

  it('does not grant admin to an email outside the allowlist', async () => {
    const supabaseMock = makeSupabaseMock();
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
      ],
    });
    const service = TestBed.inject(AuthService);

    await service.login('someone@example.com', 'real-password');

    expect(service.isAdmin()).toBeFalse();
  });
});
