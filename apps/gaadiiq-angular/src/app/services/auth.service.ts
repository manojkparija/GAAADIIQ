import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';

export interface AuthUser {
  email: string;
  name: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly STORAGE_KEY = 'gaadiiq_user';

  currentUser = signal<AuthUser | null>(this.loadUser());

  constructor(private router: Router) {}

  private loadUser(): AuthUser | null {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async login(email: string, password: string): Promise<void> {
    // Simulate network latency
    await new Promise(r => setTimeout(r, 1000));

    if (!email || password.length < 6) {
      throw new Error('Invalid email or password (min 6 characters).');
    }

    const user: AuthUser = {
      email,
      name: email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    };

    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(user));
    this.currentUser.set(user);
  }

  async register(name: string, email: string, password: string): Promise<void> {
    await new Promise(r => setTimeout(r, 1000));

    if (!name || !email || password.length < 6) {
      throw new Error('All fields are required (password min 6 characters).');
    }

    const user: AuthUser = { email, name };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(user));
    this.currentUser.set(user);
  }

  logout(): void {
    localStorage.removeItem(this.STORAGE_KEY);
    this.currentUser.set(null);
    this.router.navigate(['/']);
  }

  isLoggedIn(): boolean {
    return this.currentUser() !== null;
  }
}
