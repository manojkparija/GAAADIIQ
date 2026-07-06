import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BuyerJourneyService, JOURNEY_STEPS, BuyerProfile } from '../../services/buyer-journey.service';
import { LanguageService } from '../../services/language.service';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-buyer-journey',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './buyer-journey.component.html',
  styleUrl: './buyer-journey.component.scss',
})
export class BuyerJourneyComponent {
  readonly steps = JOURNEY_STEPS;
  currentStep = signal(0);
  // multi-select: store arrays per step
  answers = signal<Record<string, string[]>>({});
  done = signal(false);

  constructor(public journey: BuyerJourneyService, public lang: LanguageService, seo: SeoService) {
    seo.setPage('My Buyer Journey', 'Personalized car buying journey tailored to your needs.');
    if (journey.isComplete()) this.done.set(true);
  }

  get step() { return this.steps[this.currentStep()]; }

  toggle(option: string) {
    this.answers.update(a => {
      const current = a[this.step.id] ?? [];
      const exists = current.includes(option);
      return { ...a, [this.step.id]: exists ? current.filter(o => o !== option) : [...current, option] };
    });
  }

  isSelected(option: string): boolean {
    return (this.answers()[this.step.id] ?? []).includes(option);
  }

  hasSelection = computed(() => (this.answers()[this.step.id] ?? []).length > 0);

  next() {
    if (!this.hasSelection()) return;
    if (this.currentStep() < this.steps.length - 1) {
      this.currentStep.update(n => n + 1);
    } else {
      this.finish();
    }
  }

  back() {
    if (this.currentStep() > 0) this.currentStep.update(n => n - 1);
  }

  finish() {
    const a = this.answers();
    const join = (key: string) => (a[key] ?? []).join(', ');
    this.journey.saveProfile({
      budget: join('budget'),
      useCase: join('useCase'),
      fuelPreference: join('fuelPreference'),
      transmission: join('transmission'),
      bodyType: join('bodyType'),
      city: '',
      priority: join('priority'),
    } as BuyerProfile);
    this.done.set(true);
  }

  restart() {
    this.journey.clearProfile();
    this.answers.set({});
    this.currentStep.set(0);
    this.done.set(false);
  }

  get profile() { return this.journey.profile(); }
  get progress() { return Math.round((this.currentStep() / this.steps.length) * 100); }

  question() {
    return this.lang.lang() === 'hi' ? this.step.questionHi : this.step.question;
  }
}
