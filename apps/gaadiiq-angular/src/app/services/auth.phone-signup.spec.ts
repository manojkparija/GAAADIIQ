/**
 * Signing up and signing in with a mobile number.
 *
 * WHAT WAS THERE BEFORE, AND WHY IT WAS NOT THIS
 *
 * Asked: "can one user sign up through his mobile number by OTP?" The answer
 * was no. There were /auth/otp/send and /auth/otp/verify endpoints, but verify
 * returns {verified: true} and mints nothing — its own docstring says "caller
 * should then issue JWT" and no caller ever did. They prove a number belongs
 * to whoever is filling in an enquiry form. They are not an auth system, and
 * the Sign Up page carried a Phone Number field that was read nowhere.
 *
 * THE TRAP THIS FILE EXISTS TO GUARD
 *
 * Every identity path in this app was keyed by email. onAuthStateChange read
 *
 *     if (session?.user?.email) { hydrate } else { currentUser.set(null) }
 *
 * A phone account has no email, so a valid Supabase session landed in the else
 * branch: Supabase considered them signed in, the app showed them signed out,
 * and nothing anywhere raised an error. That asymmetry is invisible in any test
 * that signs in with an email, which is what every existing auth test does.
 */
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

interface Upsert { table: string; row: any; opts: any; }

function makeSupabase(opts: {
  otpError?: { message: string };
  verifyResult?: { data: any; error: any };
  profile?: any;
  upserts?: Upsert[];
  onAuthChange?: (cb: (e: string, s: any) => void) => void;
} = {}) {
  const sent: { phone: string }[] = [];
  const session = opts.verifyResult?.data?.session ?? null;
  return {
    sentOtps: sent,
    client: {
      auth: {
        getSession: () => Promise.resolve({ data: { session } }),
        onAuthStateChange: (cb: any) => {
          opts.onAuthChange?.(cb);
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        signInWithOtp: (args: { phone: string }) => {
          sent.push(args);
          return Promise.resolve({ error: opts.otpError ?? null });
        },
        verifyOtp: (_a: any) =>
          Promise.resolve(opts.verifyResult ?? { data: { session: null }, error: null }),
        signInWithPassword: () => Promise.resolve({ error: null }),
        signOut: () => Promise.resolve({ error: null }),
      },
      from: (table: string) => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.profile ?? null }) }) }),
        upsert: (row: any, o: any) => {
          opts.upserts?.push({ table, row, opts: o });
          return Promise.resolve({ error: null });
        },
      }),
    },
  };
}

function mount(sb: any) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      AuthService,
      { provide: SupabaseService, useValue: sb },
      { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
    ],
  });
  return TestBed.inject(AuthService);
}

const SESSION = (over: any = {}) => ({
  data: { session: { user: { id: 'u1', phone: '919876543210', email: undefined, ...over } } },
  error: null,
});

describe('AuthService — a mobile number is an identity', () => {
  it('normalises what a person types into E.164 before sending', async () => {
    // Three spellings of one number. If these produced three strings, one
    // person would become three accounts and the code would be sent to a
    // number the verify step then fails to match.
    for (const typed of ['9876543210', '+91 98765 43210', '0098919876543210']) {
      const sb = makeSupabase();
      const auth = mount(sb);
      await auth.sendPhoneOtp(typed);
      expect(sb.sentOtps[0].phone).withContext(typed).toBe('+919876543210');
    }
  });

  it('refuses a number that is not an Indian mobile, without sending an SMS', async () => {
    // Landlines and short numbers start outside 6-9. Rejecting here saves a
    // paid SMS and tells the person immediately rather than after a round trip.
    const sb = makeSupabase();
    const auth = mount(sb);

    await expectAsync(auth.sendPhoneOtp('1234567890')).toBeRejected();
    expect(sb.sentOtps.length).toBe(0);
  });

  it('signs the user in when the code is right', async () => {
    const upserts: Upsert[] = [];
    const sb = makeSupabase({ verifyResult: SESSION(), upserts });
    const auth = mount(sb);

    await auth.verifyPhoneOtp('9876543210', '123456');

    expect(auth.currentUser()).not.toBeNull();
    expect(auth.currentUser()?.phone).toBe('+919876543210');
    expect(auth.currentUser()?.email).toBeUndefined();
  });

  it('hydrates a session that has a phone and no email', async () => {
    // THE TRAP. onAuthStateChange used to test for an email, so this session
    // set currentUser to null — signed in by Supabase, signed out by the app.
    let fire: ((e: string, s: any) => void) | null = null;
    const sb = makeSupabase({ onAuthChange: cb => { fire = cb; } });
    const auth = mount(sb);

    fire!('SIGNED_IN', { user: { id: 'u1', phone: '919876543210' } });

    // hydrateUser awaits the profile lookup AND getSession, so it does not
    // settle within a fixed number of microtasks. Counting them is how this
    // test failed first time round, and a count that happens to pass is a
    // test that breaks when an await is added. A macrotask drains the lot.
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(auth.currentUser()).not.toBeNull();
    expect(auth.currentUser()?.phone).toBe('+919876543210');
  });

  it('writes a profile row keyed by phone, and never writes a role', async () => {
    // Writing role on every sign-in would demote a seller to 'user' the next
    // time they logged in — a privilege change caused by logging in.
    const upserts: Upsert[] = [];
    const sb = makeSupabase({ verifyResult: SESSION(), upserts });
    const auth = mount(sb);

    await auth.verifyPhoneOtp('9876543210', '123456', 'Asha');

    expect(upserts.length).toBe(1);
    expect(upserts[0].table).toBe('user_profiles');
    expect(upserts[0].row.phone).toBe('+919876543210');
    expect(upserts[0].row.name).toBe('Asha');
    expect(upserts[0].row.role).toBeUndefined();
    expect(upserts[0].opts.onConflict).toBe('phone');
  });

  it('does not sign anyone in when verify returns no session', async () => {
    // An error-free response with no session would otherwise leave the app
    // believing in a user Supabase never authenticated.
    const sb = makeSupabase({ verifyResult: { data: { session: null }, error: null } });
    const auth = mount(sb);

    await expectAsync(auth.verifyPhoneOtp('9876543210', '123456')).toBeRejected();
    expect(auth.currentUser()).toBeNull();
  });

  it('rejects a malformed code before calling Supabase', async () => {
    const sb = makeSupabase({ verifyResult: SESSION() });
    const auth = mount(sb);

    await expectAsync(auth.verifyPhoneOtp('9876543210', 'abc')).toBeRejected();
    expect(auth.currentUser()).toBeNull();
  });

  it('says something a person can act on when phone auth is switched off', async () => {
    // "Signups not allowed for otp" means the project has phone auth disabled.
    // Showing that to a user blames them for a configuration they cannot see.
    const sb = makeSupabase({ otpError: { message: 'Signups not allowed for otp' } });
    const auth = mount(sb);

    await expectAsync(auth.sendPhoneOtp('9876543210'))
      .toBeRejectedWithError(/not available right now/i);
  });

  it('turns an expired code into plain English', async () => {
    const sb = makeSupabase({
      verifyResult: { data: { session: null }, error: { message: 'Token has expired or is invalid' } },
    });
    const auth = mount(sb);

    await expectAsync(auth.verifyPhoneOtp('9876543210', '123456'))
      .toBeRejectedWithError(/wrong or has expired/i);
  });

  it('stores the phone an email signup supplies, instead of discarding it', async () => {
    // The Sign Up form has had a Phone Number field since it was written,
    // bound to a signal that nothing read. Whatever was typed there went
    // nowhere. This is the assertion that it lands in the profile row.
    const upserts: Upsert[] = [];
    const sb: any = makeSupabase({ upserts });
    sb.client.auth.signUp = () => Promise.resolve({ data: { session: {} }, error: null });
    const auth = mount(sb);

    await auth.register('Asha', 'asha@example.com', 'password123', 'customer', '+919876543210');

    const profile = upserts.find(u => u.table === 'user_profiles');
    expect(profile?.row.phone).toBe('+919876543210');
  });

  it('omits phone entirely when none is given, rather than writing null', async () => {
    // Optional means absent, not blank. Sending an explicit null would wipe a
    // number an existing row already held.
    const upserts: Upsert[] = [];
    const sb: any = makeSupabase({ upserts });
    sb.client.auth.signUp = () => Promise.resolve({ data: { session: {} }, error: null });
    const auth = mount(sb);

    await auth.register('Asha', 'asha@example.com', 'password123', 'customer', undefined);

    const profile = upserts.find(u => u.table === 'user_profiles');
    expect('phone' in profile!.row).toBe(false);
  });

  it('still hydrates an email account with no phone', async () => {
    // The other half: this change must not break the path every existing user
    // takes. An email session has no phone, and toE164(undefined) is undefined.
    const sb = makeSupabase({ profile: { role: 'seller', seller_id: 7, name: 'Ravi' } });
    const auth = mount(sb);

    await auth.login('ravi@example.com', 'password123');

    expect(auth.currentUser()?.email).toBe('ravi@example.com');
    expect(auth.currentUser()?.phone).toBeUndefined();
    expect(auth.currentUser()?.role).toBe('seller');
  });
});
