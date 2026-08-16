import { Component, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../components/icon/icon.component';

/**
 * What the person signing up is here to do.
 *
 * Deliberately not a list of account roles. `admin` is granted by an existing
 * admin against a server-side allowlist, never chosen by the person signing
 * up — see AuthService.isAdminEmail. Offering it here would let anyone award
 * themselves the mechanic verification queue, the price manager, and every
 * mechanic's PAN and Aadhaar fragment.
 */
export type AccountType = 'customer' | 'seller' | 'mechanic';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [RouterLink, CommonModule, FormsModule, IconComponent],
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
  /** Account made, waiting on the emailed confirmation link. */
  awaitingConfirmation = signal(false);
  error = signal('');

  // Customers get 3 steps, Admin/Seller get 2 (skip preferences)
  totalSteps = computed(() => this.accountType() === 'customer' ? 3 : 2);
  isCustomer = computed(() => this.accountType() === 'customer');

  preferences = ['Hatchback', 'Sedan', 'SUV', 'Electric', 'Luxury', 'Budget'];
  budgetRanges = ['Under ₹5L', '₹5L-10L', '₹10L-20L', '₹20L-30L', '30L+'];

  accountTypes: { value: AccountType; label: string; desc: string }[] = [
    { value: 'customer', label: 'Customer', desc: 'Browse & buy cars' },
    { value: 'seller',   label: 'Seller',   desc: 'List & sell cars' },
    // A mechanic could reach /mechanic-signup only by already having an
    // account, and this page offered no way to say that was why you came —
    // so "register as a mechanic" sent you here and here sent you nowhere.
    { value: 'mechanic', label: 'Mechanic', desc: 'Take repair jobs' },
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
      const usable = await this.auth.register(
        this.name(), this.email(), this.password(), this.accountType(),
      );

      // Supabase is holding the account until the emailed link is clicked, so
      // there is no session to navigate with. Sending them onward anyway put
      // them on a guarded page that bounced, and the sign-in they tried next
      // reported "incorrect password" for a password that was correct.
      if (!usable) {
        this.awaitingConfirmation.set(true);
        return;
      }

      // A mechanic account is only half of registering: the KYC details and
      // service area live on the mechanic record, so hand straight over to
      // that form rather than dropping them on the home page to find it.
      const next = {
        seller: '/dealer-dashboard',
        mechanic: '/mechanic-signup',
        customer: '/',
      }[this.accountType()] ?? '/';
      this.router.navigate([next]);
    } catch (e: any) {
      this.error.set(e.message || 'Registration failed. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
