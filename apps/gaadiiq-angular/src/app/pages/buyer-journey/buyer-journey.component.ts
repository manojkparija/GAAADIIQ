import { Component, signal } from '@angular/core';
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
  answers = signal<Record<string, string>>({});
  done = signal(false);

  constructor(public journey: BuyerJourneyService, public lang: LanguageService, seo: SeoService) {
    seo.setPage('My Buyer Journey', 'Personalized car buying journey tailored to your needs.');
    if (journey.isComplete()) this.done.set(true);
  }

  get step() { return this.steps[this.currentStep()]; }

  select(option: string) {
    this.answers.update(a => ({ ...a, [this.step.id]: option }));
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
    this.journey.saveProfile({
      budget: a['budget'] ?? '',
      useCase: a['useCase'] ?? '',
      fuelPreference: a['fuelPreference'] ?? '',
      transmission: a['transmission'] ?? '',
      bodyType: a['bodyType'] ?? '',
      city: '',
      priority: a['priority'] ?? '',
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
