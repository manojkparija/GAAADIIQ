import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from './supabase.service';

export type UserRole = 'user' | 'seller' | 'admin';

export interface AuthUser {
  email: string;
  name: string;
  role: UserRole;
  sellerId?: number;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly STORAGE_KEY = 'gaadiiq_user';
  private readonly REGISTERED_EMAILS_KEY = 'gaadiiq_registered_emails';

  currentUser = signal<AuthUser | null>(this.loadUser());

  constructor(private router: Router, private sb: SupabaseService) {
    // Silently refresh role for any stored session that may have stale 'user' role
    const stored = this.loadUser();
    if (stored && stored.role === 'user') {
      this.refreshStoredRole(stored);
    }
  }

  private async refreshStoredRole(stored: AuthUser) {
    const { role, sellerId } = await this.fetchRole(stored.email);
    if (role !== stored.role || sellerId !== stored.sellerId) {
      const updated = { ...stored, role, sellerId };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(updated));
      this.currentUser.set(updated);
    }
  }

  private loadUser(): AuthUser | null {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private async fetchRole(email: string): Promise<{ role: UserRole; sellerId?: number }> {
    // First check user_profiles table
    const { data: profile } = await this.sb.client
      .from('user_profiles')
      .select('role, seller_id')
      .eq('email', email)
      .single();

    if (profile?.role && profile.role !== 'user') {
      return { role: profile.role as UserRole, sellerId: profile.seller_id ?? undefined };
    }

    // Fallback: check sellers table — if email matches, they are a seller
    const { data: seller } = await this.sb.client
      .from('sellers')
      .select('id')
      .eq('email', email)
      .single();

    if (seller) {
      return { role: 'seller', sellerId: seller.id };
    }

    return { role: (profile?.role as UserRole) ?? 'user', sellerId: profile?.seller_id ?? undefined };
  }

  async login(email: string, password: string): Promise<void> {
    await new Promise(r => setTimeout(r, 800));

    if (!email || password.length < 6) {
      throw new Error('Invalid email or password (min 6 characters).');
    }

    const { role, sellerId } = await this.fetchRole(email);
    const name = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const user: AuthUser = { email, name, role, sellerId };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(user));
    this.saveRegisteredEmail(email);
    this.currentUser.set(user);
  }

  async register(name: string, email: string, password: string, accountType: 'customer' | 'seller' | 'admin' = 'customer'): Promise<void> {
    await new Promise(r => setTimeout(r, 800));

    if (!name || !email || password.length < 6) {
      throw new Error('All fields are required (password min 6 characters).');
    }

    // Check if email is already registered
    const { data: existing } = await this.sb.client
      .from('user_profiles')
      .select('email')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      throw new Error('This email is already registered. Please sign in instead.');
    }

    const role: UserRole = accountType === 'customer' ? 'user' : accountType;

    await this.sb.client
      .from('user_profiles')
      .insert({ email, name, role });

    const user: AuthUser = { email, name, role };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(user));
    this.saveRegisteredEmail(email);
    this.currentUser.set(user);
  }

  logout(): void {
    localStorage.removeItem(this.STORAGE_KEY);
    this.currentUser.set(null);
    this.router.navigate(['/']);
  }

  private getRegisteredEmails(): Set<string> {
    try {
      const raw = localStorage.getItem(this.REGISTERED_EMAILS_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  }

  private saveRegisteredEmail(email: string) {
    const emails = this.getRegisteredEmails();
    emails.add(email.toLowerCase());
    localStorage.setItem(this.REGISTERED_EMAILS_KEY, JSON.stringify([...emails]));
  }

  async isEmailTaken(email: string): Promise<boolean> {
    const lc = email.toLowerCase();
    // Check localStorage registry (catches pre-DB registrations)
    if (this.getRegisteredEmails().has(lc)) return true;
    // Also seed the registry from all known localStorage keys
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? '';
      if (key.startsWith('gaadiiq_listings_')) {
        const storedEmail = key.replace('gaadiiq_listings_', '').toLowerCase();
        this.saveRegisteredEmail(storedEmail);
        if (storedEmail === lc) return true;
      }
    }
    // Check the currently-stored session email
    const stored = this.loadUser();
    if (stored?.email?.toLowerCase() === lc) return true;

    // Then check Supabase
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
  isUser(): boolean     { return this.currentUser()?.role === 'user' || !this.currentUser(); }
}
