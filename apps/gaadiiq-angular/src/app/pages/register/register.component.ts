import { Component, signal, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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

  progressWidth = computed(() => `${((this.step() - 1) / (this.totalSteps - 1)) * 100}%`);

  preferences = ['Hatchback', 'Sedan', 'SUV', 'Electric', 'Luxury', 'Budget'];
  budgetRanges = ['Under ₹5L', '₹5L-10L', '₹10L-20L', '₹20L-30L', '30L+'];

  nextStep() { if (this.step() < this.totalSteps) this.step.update(v => v + 1); }
  prevStep() { if (this.step() > 1) this.step.update(v => v - 1); }

  togglePref(p: string) {
    this.interestedIn.update(arr => arr.includes(p) ? arr.filter(x => x !== p) : [...arr, p]);
  }

  hasPref(p: string) { return this.interestedIn().includes(p); }

  onSubmit() { console.log('Register submitted'); }
}
