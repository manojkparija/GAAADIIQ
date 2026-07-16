import { Component, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

export type AccountType = 'customer' | 'seller';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [RouterLink, CommonModule, FormsModule],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss'
})
export class RegisterComponent {
  step = signal(1);

  name = signal('');
  email = signal('');
  phone = signal('');
  accountType = signal<AccountType>('customer');
  password = signal('');
  confirmPassword = signal('');
  interestedIn = signal<string[]>([]);
  budget = signal('');
  notifications = signal(true);
  loading = signal(false);
  error = signal('');

  // Customers get 3 steps, Admin/Seller get 2 (skip preferences)
  totalSteps = computed(() => this.accountType() === 'customer' ? 3 : 2);
  isCustomer = computed(() => this.accountType() === 'customer');

  preferences = ['Hatchback', 'Sedan', 'SUV', 'Electric', 'Luxury', 'Budget'];
  budgetRanges = ['Under ₹5L', '₹5L-10L', '₹10L-20L', '₹20L-30L', '30L+'];

  accountTypes: { value: AccountType; label: string; desc: string }[] = [
    { value: 'customer', label: 'Customer', desc: 'Browse & buy cars' },
    { value: 'seller',   label: 'Seller',   desc: 'List & sell cars' },
  ];

  checkingEmail = signal(false);

  constructor(private auth: AuthService, private router: Router) {}

  async nextStep() {
    this.error.set('');
    if (this.step() === 1) {
      if (!this.name() || !this.email()) { this.error.set('Name and email are required.'); return; }
      // Check email uniqueness before proceeding
      this.checkingEmail.set(true);
      const taken = await this.auth.isEmailTaken(this.email());
      this.checkingEmail.set(false);
      if (taken) { this.error.set('This email is already registered. Please sign in instead.'); return; }
    }
    if (this.step() === 2) {
      if (this.password().length < 8) { this.error.set('Password must be at least 8 characters.'); return; }
      if (this.password() !== this.confirmPassword()) { this.error.set('Passwords do not match.'); return; }
      // Admin/Seller skip preferences → submit directly
      if (!this.isCustomer()) { this.onSubmit(); return; }
    }
    if (this.step() < this.totalSteps()) this.step.update(v => v + 1);
  }

  prevStep() { if (this.step() > 1) this.step.update(v => v - 1); }

  togglePref(p: string) {
    this.interestedIn.update(arr => arr.includes(p) ? arr.filter(x => x !== p) : [...arr, p]);
  }

  hasPref(p: string) { return this.interestedIn().includes(p); }

  async onSubmit() {
    this.error.set('');
    this.loading.set(true);
    try {
      await this.auth.register(this.name(), this.email(), this.password(), this.accountType());
      this.router.navigate([this.accountType() === 'seller' ? '/dealer-dashboard' : '/']);
    } catch (e: any) {
      this.error.set(e.message || 'Registration failed. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
