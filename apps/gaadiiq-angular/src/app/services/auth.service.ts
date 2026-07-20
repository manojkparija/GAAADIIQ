import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from './supabase.service';

export type UserRole = 'user' | 'seller' | 'admin';

export interface AuthUser {
  id?: string;
  email: string;
  name: string;
  role: UserRole;
  sellerId?: number;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  currentUser = signal<AuthUser | null>(null);

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

  private async fetchProfile(email: string): Promise<{ role: UserRole; sellerId?: number; name: string }> {
    const { data: profile } = await this.sb.client
      .from('user_profiles')
      .select('role, seller_id, name')
      .eq('email', email)
      .maybeSingle();

    if (profile) {
      return {
        role: (profile.role as UserRole) ?? 'user',
        sellerId: profile.seller_id ?? undefined,
        name: profile.name ?? this.nameFromEmail(email),
      };
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

    const { error } = await this.sb.client.auth.signInWithPassword({ email, password });
    if (error) {
      // Supabase returns "Invalid login credentials" for wrong password or unknown email
      throw new Error('Incorrect email or password. Please try again.');
    }
    // onAuthStateChange fires and calls hydrateUser
  }

  async register(
    name: string,
    email: string,
    password: string,
    accountType: 'customer' | 'seller' = 'customer',
  ): Promise<void> {
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

    const role: UserRole = accountType === 'customer' ? 'user' : 'seller';

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
    }
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
  isAdmin(): boolean    { return this.currentUser()?.role === 'admin'; }
  isSeller(): boolean   { return this.currentUser()?.role === 'seller'; }
  isUser(): boolean     { return this.currentUser()?.role === 'user'; }
}
