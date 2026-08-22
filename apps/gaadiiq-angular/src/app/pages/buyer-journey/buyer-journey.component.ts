import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { BuyerJourneyService, JOURNEY_STEPS, BuyerProfile } from '../../services/buyer-journey.service';
import { LanguageService } from '../../services/language.service';
import { SeoService } from '../../services/seo.service';
import { AnalyticsService } from '../../services/analytics.service';
import { IconComponent } from '../../components/icon/icon.component';
import { TranslatePipe } from '../../pipes/translate.pipe';

interface Milestone { id: string; icon: string; title: string; desc: string; link?: string; linkLabel?: string; }

@Component({
  selector: 'app-buyer-journey',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, IconComponent, TranslatePipe],
  templateUrl: './buyer-journey.component.html',
  styleUrl: './buyer-journey.component.scss',
})
export class BuyerJourneyComponent {
  readonly steps = JOURNEY_STEPS;
  currentStep = signal(0);
  answers = signal<Record<string, string[]>>({});
  done = signal(false);

  milestones: Milestone[] = [
    { id: 'research',   icon: 'search', title: 'Research',      desc: 'Explore car types, compare features, and read expert reviews to build your shortlist.',   link: '/listings',     linkLabel: 'Browse Cars' },
    { id: 'finance',    icon: 'calculator', title: 'Finance',       desc: 'Check EMI options, get loan pre-approval, and understand your total cost of ownership.', link: '/emi-calculator', linkLabel: 'EMI Calculator' },
    { id: 'shortlist',  icon: 'star', title: 'Shortlist',     desc: 'Narrow down to 2–3 options based on your budget, fuel preference, and lifestyle needs.',  link: '/compare',      linkLabel: 'Compare Cars' },
    { id: 'testdrive',  icon: '🗝️', title: 'Test Drive',    desc: 'Book test drives for your shortlisted cars and validate real-world comfort and features.', link: '/test-drive',   linkLabel: 'Book Test Drive' },
    { id: 'negotiate',  icon: '🤝', title: 'Negotiate',     desc: 'Use market price data and competing offers to negotiate the best deal with your dealer.',  link: '/used-cars', linkLabel: 'Browse Listings' },
    { id: 'purchase',   icon: '🎉', title: 'Purchase',      desc: 'Finalize paperwork, register your vehicle, and drive home your dream car!',               link: '/listings',     linkLabel: 'Start Journey' },
  ];

  completedMilestones = signal<string[]>(['research', 'finance']);

  constructor(public journey: BuyerJourneyService, public lang: LanguageService, seo: SeoService, private router: Router, private analytics: AnalyticsService) {
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
    const profile: BuyerProfile = {
      budget: join('budget'),
      useCase: join('useCase'),
      fuelPreference: join('fuelPreference'),
      transmission: join('transmission'),
      bodyType: join('bodyType'),
      city: '',
      priority: join('priority'),
    };
    this.journey.saveProfile(profile);
    this.analytics.track('journey_complete', {
      budget:    profile.budget,
      fuel:      profile.fuelPreference,
      body_type: profile.bodyType,
    });
    this.done.set(true);
  }

  seeMatchedCars() {
    const profile = this.journey.profile();
    if (!profile) { this.router.navigate(['/used-cars']); return; }

    // Extract first fuel type
    const fuel = profile.fuelPreference?.split(',')[0]?.trim() ?? '';
    // Extract first body type
    const bodyType = profile.bodyType?.split(',')[0]?.trim() ?? '';
    // Parse max budget from e.g. "₹5L–₹10L, ₹10L–₹15L" → take highest upper bound
    let maxBudget = 5000000;
    const budgetMatches = (profile.budget ?? '').match(/₹(\d+)L/g);
    if (budgetMatches && budgetMatches.length > 0) {
      const nums = budgetMatches.map(m => +m.replace('₹', '').replace('L', '') * 100000);
      maxBudget = Math.max(...nums);
    }

    this.router.navigate(['/used-cars'], { queryParams: {
      fuel: fuel || null,
      bodyType: bodyType || null,
      maxBudget: maxBudget !== 5000000 ? maxBudget : null,
    }});
  }

  restart() {
    this.analytics.track('journey_retake');
    this.journey.clearProfile();
    this.answers.set({});
    this.currentStep.set(0);
    this.done.set(false);
    this.completedMilestones.set(['research', 'finance']);
  }

  toggleMilestone(id: string) {
    this.completedMilestones.update(list =>
      list.includes(id) ? list.filter(m => m !== id) : [...list, id]
    );
  }

  isMilestoneComplete(id: string) { return this.completedMilestones().includes(id); }

  milestoneProgress = computed(() =>
    Math.round((this.completedMilestones().length / this.milestones.length) * 100)
  );

  get profile() { return this.journey.profile(); }
  get progress() { return Math.round((this.currentStep() / this.steps.length) * 100); }

  question() {
    return this.lang.lang() === 'hi' ? this.step.questionHi : this.step.question;
  }
}
