import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from './supabase.service';
import { environment } from '../../environments/environment';

export type UserRole = 'user' | 'seller' | 'admin';

export interface AuthUser {
  id?: string;
  /**
   * Optional since phone sign-up existed. An account created with
   * signInWithOtp({ phone }) has no email at all, and reading `.email` on one
   * yields undefined rather than a string.
   *
   * Everything that needs to name or contact this user must cope with that.
   * Most call sites already did (`?.email ?? null`); the ones that did not are
   * the ones TypeScript flagged when this stopped being required.
   */
  email?: string;
  /** E.164. Set for accounts created by phone OTP, absent for the rest. */
  phone?: string;
  name: string;
  role: UserRole;
  sellerId?: number;
  /**
   * True when this session exists only in the browser — the dev shortcut,
   * with no Supabase session behind it.
   *
   * Such a user can open admin screens but cannot call any authenticated API
   * endpoint, because there is no token to send. Screens that talk to the API
   * must check this and say so, rather than letting the request fail with an
   * opaque "Not authenticated".
   */
  localOnly?: boolean;
}

/**
 * The account exists and the password was right — Supabase is waiting for the
 * confirmation link to be clicked. A distinct type because the fix is
 * completely different from a wrong password, and the UI has to offer a resend
 * rather than a retry.
 */
export class UnconfirmedEmailError extends Error {
  constructor(readonly email: string) {
    super('Your email address has not been confirmed yet.');
    this.name = 'UnconfirmedEmailError';
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  /**
   * Password for the browser-only dev shortcut. Not a credential for any real
   * account — it only unlocks a session with no Supabase token behind it, and
   * only in non-production builds.
   */
  private static readonly DEV_ADMIN_PASSWORD = 'admin123';

  currentUser = signal<AuthUser | null>(null);

  /**
   * Why Supabase refused the dev-shortcut sign-in, when it did.
   *
   * Shown in the admin warning banner: an unconfirmed email and a wrong
   * password both land in the same browser-only fallback but need different
   * fixes.
   */
  localOnlyReason = signal<string | null>(null);

  constructor(private router: Router, private sb: SupabaseService) {
    // Restore session from Supabase on boot
    this.sb.client.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        this.hydrateUser(data.session.user.email, data.session.user.phone);
      }
    });

    // Keep signal in sync with Supabase auth state changes
    //
    // The test here is the *session*, not the email on it. It used to be
    // `if (session?.user?.email)`, which is correct right up until an account
    // has no email: a phone user would hold a valid Supabase session and be
    // dropped straight into the else branch, so currentUser went null and the
    // app showed them signed out while Supabase considered them signed in.
    // Nothing would have reported that as an error.
    this.sb.client.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        this.hydrateUser(session.user.email, session.user.phone);
      } else {
        this.currentUser.set(null);
      }
    });
  }

  /**
   * Build the app's user from whichever identifier the session actually
   * carries. Supabase gives a phone as bare digits ("919876543210") where the
   * profile table stores E.164, so it is normalised on the way in rather than
   * at each lookup.
   */
  private async hydrateUser(email?: string, phone?: string): Promise<void> {
    const e164 = AuthService.toE164(phone);
    if (!email && !e164) { this.currentUser.set(null); return; }

    const { role, sellerId, name } = await this.fetchProfile(email, e164);
    const { data } = await this.sb.client.auth.getSession();
    const id = data.session?.user?.id;
    this.currentUser.set({ id, email, phone: e164, name, role, sellerId });
  }

  /**
   * Normalise a phone number to +91XXXXXXXXXX, or null when it is not a valid
   * Indian mobile number.
   *
   * Deliberately the same rule as LeadService.toE164 — Indian mobiles start
   * 6-9 — because a number typed into the enquiry form and the same number
   * typed into sign-up must produce the same string, or one person ends up as
   * two records. Supabase hands phones back without the +, so a bare
   * "919876543210" has to normalise to the same value as "+91 98765 43210".
   */
  static toE164(raw: string | null | undefined): string | undefined {
    const digits = (raw ?? '').replace(/\D/g, '');
    const ten = digits.length > 10 ? digits.slice(-10) : digits;
    return /^[6-9]\d{9}$/.test(ten) ? `+91${ten}` : undefined;
  }

  /**
   * Emails granted admin regardless of what the profile tables say.
   *
   * Mirrors the API's ADMIN_EMAILS allowlist. Without this, signing in with a
   * genuine Supabase admin account that has no `user_profiles` row yields role
   * 'user' and the admin screens vanish — the API would accept the upload, but
   * the page to start it would not be reachable. This is presentation only: the
   * server re-checks its own allowlist against a verified token, so listing an
   * email here grants nothing on its own.
   */
  private isAdminEmail(email?: string): boolean {
    const target = (email || '').trim().toLowerCase();
    // An empty identifier must never match an empty allowlist entry, which is
    // what a stray blank line in environment.adminEmails would produce.
    if (!target) return false;
    return (environment.adminEmails ?? []).some(a => a.trim().toLowerCase() === target);
  }

  private async fetchProfile(
    email?: string,
    phone?: string,
  ): Promise<{ role: UserRole; sellerId?: number; name: string }> {
    // Email first when both exist: it is the identifier every existing row is
    // keyed by, and the one the admin allowlist is written in terms of.
    const { data: profile } = email
      ? await this.sb.client
          .from('user_profiles').select('role, seller_id, name')
          .eq('email', email).maybeSingle()
      : await this.sb.client
          .from('user_profiles').select('role, seller_id, name')
          .eq('phone', phone!).maybeSingle();

    // A phone-only account has no email to derive a display name from, so it
    // falls back to the number. Better than an empty header, and it is what
    // they signed up with.
    const fallbackName = email ? this.nameFromEmail(email) : (phone ?? 'You');

    if (profile) {
      return {
        role: this.isAdminEmail(email) ? 'admin' : ((profile.role as UserRole) ?? 'user'),
        sellerId: profile.seller_id ?? undefined,
        name: profile.name ?? fallbackName,
      };
    }

    if (this.isAdminEmail(email)) {
      return { role: 'admin', name: this.nameFromEmail(email!) };
    }

    // No seller lookup for a phone-only account: the sellers table is keyed by
    // email, so there is nothing to match on. Such a user is role 'user' until
    // they go through /list-car or /mechanic-signup like anyone else.
    if (!email) {
      return { role: 'user', name: fallbackName };
    }

    // Fallback: check sellers table (existing seller accounts pre-dating user_profiles rows)
    const { data: seller } = await this.sb.client
      .from('sellers')
      .select('id, name')
      .eq('email', email)
      .maybeSingle();

    if (seller) {
      return { role: 'seller', sellerId: seller.id, name: seller.name ?? this.nameFromEmail(email) };
    }

    return { role: 'user', name: this.nameFromEmail(email) };
  }

  private nameFromEmail(email: string): string {
    return email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  async login(email: string, password: string): Promise<void> {
    if (!email || password.length < 6) {
      throw new Error('Invalid email or password (min 6 characters).');
    }

    // Supabase gets the credentials FIRST, always — whatever they are.
    //
    // This ordering is the fix for a real bug: the dev shortcut used to be
    // checked first, and because it only matched on the hardcoded password, it
    // then sent *that* password to Supabase. An admin whose Supabase account
    // had a different password could never sign in for real: Supabase answered
    // "Invalid login credentials" to a password the user had not typed, and the
    // session silently degraded to browser-only. Trying the real credentials
    // first means a genuine account always wins.
    const { error } = await this.sb.client.auth.signInWithPassword({ email, password });
    if (!error) {
      this.localOnlyReason.set(null);
      // AUTH-03: hydrate synchronously so currentUser is non-null before caller navigates
      await this.hydrateUser(email);
      return;
    }

    // Dev-only fallback, reached solely when Supabase has already refused.
    //
    // Gated on !production so a shipped build cannot be entered with a password
    // that is sitting in this file. The resulting session exists only in the
    // browser: no token is attached to API calls, so authenticated endpoints
    // (file ingestion, the Gemini admin tier) treat it as anonymous. It is
    // marked localOnly so the UI can say so instead of letting every request
    // fail with an opaque error.
    if (
      !environment.production &&
      email === environment.devAdminEmail &&
      password === AuthService.DEV_ADMIN_PASSWORD
    ) {
      // Keep Supabase's own words: "Email not confirmed" and "Invalid login
      // credentials" need completely different fixes, and without the message
      // the two are indistinguishable from the UI.
      console.warn('Supabase rejected the dev admin sign-in:', error.message);
      this.localOnlyReason.set(error.message);
      this.currentUser.set({ email, name: 'Admin', role: 'admin', localOnly: true });
      return;
    }

    this.localOnlyReason.set(null);

    // Say which failure it was.
    //
    // Every Supabase error used to become "Incorrect email or password",
    // including "Email not confirmed" — so someone who had just signed up and
    // not yet clicked the link in their inbox was told their password was
    // wrong, and retyping it could never work. The comment in the dev-admin
    // branch above already says these two need completely different fixes;
    // this is the same reasoning applied to the path real users take.
    const reason = (error.message || '').toLowerCase();
    if (reason.includes('not confirmed') || reason.includes('confirm your email')) {
      throw new UnconfirmedEmailError(email);
    }
    // "Invalid login credentials" stays deliberately vague: distinguishing a
    // wrong password from an unknown address turns the form into a way to test
    // whether someone has an account here.
    throw new Error('Incorrect email or password. Please try again.');
  }

  async register(
    name: string,
    email: string,
    password: string,
    // 'mechanic' is why they signed up, not a role they hold: a mechanic's
    // account is an ordinary user account, and the mechanic record created on
    // /mechanic-signup is what makes them one. Roles that grant anything —
    // seller, admin — are not self-selected here.
    accountType: 'customer' | 'seller' | 'mechanic' = 'customer',
    // Optional, already E.164 or undefined. The Sign Up form has collected a
    // phone number since it was written and threw it away: the field was bound
    // to a signal nothing read. Optional by decision, so an absent or
    // unparseable number must never block a signup — it is just not stored.
    phone?: string,
    // Returns true when the account is usable immediately, false when Supabase
    // is waiting on email confirmation.
  ): Promise<boolean> {
    if (!name || !email || password.length < 8) {
      throw new Error('All fields are required (password min 8 characters).');
    }

    // Create Supabase Auth account (handles password hashing)
    const { data, error } = await this.sb.client.auth.signUp({ email, password });
    if (error) {
      if (error.message.toLowerCase().includes('already registered')) {
        throw new Error('This email is already registered. Please sign in instead.');
      }
      throw new Error(error.message);
    }

    const role: UserRole = accountType === 'seller' ? 'seller' : 'user';

    // Upsert profile row
    await this.sb.client
      .from('user_profiles')
      // Spread rather than `phone` directly: writing an explicit undefined
      // sends a null, which would wipe a number an existing row already holds
      // if this upsert ever runs for a returning address.
      .upsert(
        { email, name, role, ...(phone ? { phone } : {}) },
        { onConflict: 'email', ignoreDuplicates: false },
      );

    // For sellers: ensure a sellers row exists so they can receive enquiries and manage inventory
    if (role === 'seller') {
      const { data: existingSeller } = await this.sb.client
        .from('sellers')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (!existingSeller) {
        const { data: newSeller } = await this.sb.client
          .from('sellers')
          .insert({ email, name, business_name: name, city: 'India', is_verified: false })
          .select('id')
          .single();

        // Backfill seller_id into user_profiles
        if (newSeller?.id) {
          await this.sb.client
            .from('user_profiles')
            .update({ seller_id: newSeller.id })
            .eq('email', email);
        }
      }
    }

    // If Supabase returns a session immediately (email confirm disabled), hydrate now
    if (data.session?.user) {
      await this.hydrateUser(email);
      return true;
    }
    // No session means Supabase is waiting for the confirmation link. The
    // caller must not navigate into a signed-in area: every guarded page will
    // bounce them, and the next sign-in attempt fails until the link is
    // clicked — which is how a new mechanic ended up being told their password
    // was wrong.
    return false;
  }

  /**
   * Ask Supabase to send the confirmation email again.
   *
   * The first one expires, and lands in spam often enough that "check your
   * inbox" with no way to retry is a dead end.
   */
  async resendConfirmation(email: string): Promise<void> {
    const { error } = await this.sb.client.auth.resend({ type: 'signup', email });
    if (error) throw new Error(error.message);
  }

  /**
   * Send a sign-in code to a mobile number.
   *
   * WHY SUPABASE AND NOT THE /auth/otp ENDPOINTS THIS REPO ALREADY HAS
   *
   * Those endpoints verify that a number belongs to whoever is filling in an
   * enquiry form. They return `{verified: true}` and mint nothing — their own
   * docstring says "caller should then issue JWT", and no caller does. Making
   * them an auth system would mean the API issuing Supabase sessions, which
   * needs a service-role key it does not have and does not currently carry any
   * Supabase config at all.
   *
   * signInWithOtp does the part that is missing: a real session, the same
   * shape OAuth and password sign-in already produce, which onAuthStateChange
   * above picks up for free.
   *
   * `shouldCreateUser` is left at its default of true, because this one call
   * is both sign-up and sign-in. A number that has signed in before gets its
   * existing account; a new one gets an account created. There is no way to
   * tell those apart from the outside, which is the point — a phone user does
   * not pick between two tabs.
   */
  async sendPhoneOtp(rawPhone: string): Promise<string> {
    const phone = AuthService.toE164(rawPhone);
    if (!phone) {
      throw new Error('Enter a valid 10-digit Indian mobile number.');
    }

    const { error } = await this.sb.client.auth.signInWithOtp({ phone });
    if (error) throw new Error(this.phoneErrorMessage(error.message));
    return phone;
  }

  /**
   * Check the code and, on success, start the session.
   *
   * `type: 'sms'` is required and is not the default — omitting it makes
   * Supabase look for an email OTP and reject every code with "Token has
   * expired or is invalid", which reads as a user error rather than a caller
   * mistake.
   *
   * The profile row is written here rather than in a signup method because
   * there is no separate signup: this is the first moment the account is known
   * to exist. upsert on `phone` makes a returning user's sign-in a no-op
   * instead of a duplicate-key failure.
   */
  async verifyPhoneOtp(rawPhone: string, code: string, name?: string): Promise<void> {
    const phone = AuthService.toE164(rawPhone);
    if (!phone) throw new Error('Enter a valid 10-digit Indian mobile number.');
    if (!/^\d{4,8}$/.test((code ?? '').trim())) {
      throw new Error('Enter the code from the SMS.');
    }

    const { data, error } = await this.sb.client.auth.verifyOtp({
      phone, token: code.trim(), type: 'sms',
    });
    if (error) throw new Error(this.phoneErrorMessage(error.message));
    if (!data.session) throw new Error('Could not start a session. Please try again.');

    // ignoreDuplicates is false so a returning user who supplies a name gets
    // it updated rather than silently dropped. role is NOT written here: an
    // upsert that always sets it would demote a seller to 'user' on their next
    // sign-in, which is a privilege change made by logging in.
    const row: Record<string, unknown> = { phone };
    if (name?.trim()) row['name'] = name.trim();
    await this.sb.client
      .from('user_profiles')
      .upsert(row, { onConflict: 'phone', ignoreDuplicates: false });

    await this.hydrateUser(data.session.user.email, data.session.user.phone);
  }

  /**
   * Supabase's own wording for the states a person can actually fix.
   *
   * The raw messages are written for a developer reading a log. "Signups not
   * allowed for otp" in particular means phone auth is switched off in the
   * project, which the person at the keyboard can do nothing about and should
   * not be shown as though they typed something wrong.
   */
  private phoneErrorMessage(raw: string): string {
    const m = (raw || '').toLowerCase();
    if (m.includes('expired') || m.includes('invalid')) {
      return 'That code is wrong or has expired. Request a new one.';
    }
    if (m.includes('rate') || m.includes('too many') || m.includes('security purposes')) {
      return 'Too many attempts. Please wait a minute and try again.';
    }
    if (m.includes('signups not allowed') || m.includes('unsupported phone provider')
        || m.includes('sms provider')) {
      return 'Mobile sign-in is not available right now. Please use email or Google.';
    }
    return raw;
  }

  async logout(): Promise<void> {
    await this.sb.client.auth.signOut();
    this.currentUser.set(null);
    this.router.navigate(['/']);
  }

  async loginWithGoogle(): Promise<void> {
    const { error } = await this.sb.client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw new Error(error.message);
  }

  async loginWithFacebook(): Promise<void> {
    const { error } = await this.sb.client.auth.signInWithOAuth({
      provider: 'facebook',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw new Error(error.message);
  }

  async sendPasswordReset(email: string): Promise<void> {
    const { error } = await this.sb.client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw new Error(error.message);
  }

  async isEmailTaken(email: string): Promise<boolean> {
    const { data } = await this.sb.client
      .from('user_profiles')
      .select('email')
      .eq('email', email)
      .maybeSingle();
    return !!data;
  }

  isLoggedIn(): boolean { return this.currentUser() !== null; }
  /** Signed in in the browser only — no Supabase session, so no API access. */
  isLocalOnly(): boolean { return this.currentUser()?.localOnly === true; }
  isAdmin(): boolean    { return this.currentUser()?.role === 'admin'; }
  isSeller(): boolean   { return this.currentUser()?.role === 'seller'; }
  isUser(): boolean     { return this.currentUser()?.role === 'user'; }
}
