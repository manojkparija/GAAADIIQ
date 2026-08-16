import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from './supabase.service';
import { environment } from '../../environments/environment';

export type UserRole = 'user' | 'seller' | 'admin';

export interface AuthUser {
  id?: string;
  email: string;
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
      if (data.session?.user?.email) {
        this.hydrateUser(data.session.user.email);
      }
    });

    // Keep signal in sync with Supabase auth state changes
    this.sb.client.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.email) {
        this.hydrateUser(session.user.email);
      } else {
        this.currentUser.set(null);
      }
    });
  }

  private async hydrateUser(email: string): Promise<void> {
    const { role, sellerId, name } = await this.fetchProfile(email);
    const { data } = await this.sb.client.auth.getSession();
    const id = data.session?.user?.id;
    this.currentUser.set({ id, email, name, role, sellerId });
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
  private isAdminEmail(email: string): boolean {
    const target = (email || '').trim().toLowerCase();
    return (environment.adminEmails ?? []).some(a => a.trim().toLowerCase() === target);
  }

  private async fetchProfile(email: string): Promise<{ role: UserRole; sellerId?: number; name: string }> {
    const { data: profile } = await this.sb.client
      .from('user_profiles')
      .select('role, seller_id, name')
      .eq('email', email)
      .maybeSingle();

    if (profile) {
      return {
        role: this.isAdminEmail(email) ? 'admin' : ((profile.role as UserRole) ?? 'user'),
        sellerId: profile.seller_id ?? undefined,
        name: profile.name ?? this.nameFromEmail(email),
      };
    }

    if (this.isAdminEmail(email)) {
      return { role: 'admin', name: this.nameFromEmail(email) };
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
      .upsert({ email, name, role }, { onConflict: 'email', ignoreDuplicates: false });

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
