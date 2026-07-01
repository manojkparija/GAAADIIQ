import { Component, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [RouterLink, CommonModule, FormsModule],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss'
})
export class RegisterComponent {
  step = signal(1);
  totalSteps = 3;

  name = signal('');
  email = signal('');
  phone = signal('');
  password = signal('');
  confirmPassword = signal('');
  interestedIn = signal<string[]>([]);
  budget = signal('');
  notifications = signal(true);
  loading = signal(false);
  error = signal('');

  progressWidth = computed(() => `${((this.step() - 1) / (this.totalSteps - 1)) * 100}%`);

  preferences = ['Hatchback', 'Sedan', 'SUV', 'Electric', 'Luxury', 'Budget'];
  budgetRanges = ['Under ₹5L', '₹5L-10L', '₹10L-20L', '₹20L-30L', '30L+'];

  constructor(private auth: AuthService, private router: Router) {}

  nextStep() {
    this.error.set('');
    if (this.step() === 1) {
      if (!this.name() || !this.email()) { this.error.set('Name and email are required.'); return; }
      if (this.password().length < 6) { this.error.set('Password must be at least 6 characters.'); return; }
      if (this.password() !== this.confirmPassword()) { this.error.set('Passwords do not match.'); return; }
    }
    if (this.step() < this.totalSteps) this.step.update(v => v + 1);
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
      await this.auth.register(this.name(), this.email(), this.password());
      this.router.navigate(['/']);
    } catch (e: any) {
      this.error.set(e.message || 'Registration failed. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
