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

  currentUser = signal<AuthUser | null>(this.loadUser());

  constructor(private router: Router, private sb: SupabaseService) {}

  private loadUser(): AuthUser | null {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private async fetchRole(email: string): Promise<{ role: UserRole; sellerId?: number }> {
    const { data } = await this.sb.client
      .from('user_profiles')
      .select('role, seller_id')
      .eq('email', email)
      .single();
    return { role: (data?.role as UserRole) ?? 'user', sellerId: data?.seller_id ?? undefined };
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
    this.currentUser.set(user);
  }

  async register(name: string, email: string, password: string, accountType: 'customer' | 'seller' | 'admin' = 'customer'): Promise<void> {
    await new Promise(r => setTimeout(r, 800));

    if (!name || !email || password.length < 6) {
      throw new Error('All fields are required (password min 6 characters).');
    }

    const role: UserRole = accountType === 'customer' ? 'user' : accountType;

    await this.sb.client
      .from('user_profiles')
      .upsert({ email, name, role }, { onConflict: 'email', ignoreDuplicates: true });

    const user: AuthUser = { email, name, role };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(user));
    this.currentUser.set(user);
  }

  logout(): void {
    localStorage.removeItem(this.STORAGE_KEY);
    this.currentUser.set(null);
    this.router.navigate(['/']);
  }

  isLoggedIn(): boolean { return this.currentUser() !== null; }
  isAdmin(): boolean    { return this.currentUser()?.role === 'admin'; }
  isSeller(): boolean   { return this.currentUser()?.role === 'seller'; }
  isUser(): boolean     { return this.currentUser()?.role === 'user' || !this.currentUser(); }
}
