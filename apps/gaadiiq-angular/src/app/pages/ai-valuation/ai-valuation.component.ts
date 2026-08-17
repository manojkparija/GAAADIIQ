import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';
import { IconComponent } from '../../components/icon/icon.component';
import { SupabaseService } from '../../services/supabase.service';
import { PricingStrategyComponent } from '../../components/pricing-strategy/pricing-strategy.component';
import { CustomSelectComponent, SelectOption } from '../../components/custom-select/custom-select.component';
import { DemandService, DaysTurn } from '../../services/demand.service';
import { CATALOGUE, Variant, ValuationResult, computeHeuristicValuation } from '../../utils/valuation-engine';

@Component({
  selector: 'app-ai-valuation',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent, PricingStrategyComponent, CustomSelectComponent],
  templateUrl: './ai-valuation.component.html',
  styleUrl: './ai-valuation.component.scss',
})
export class AiValuationComponent {
  constructor(private supabase: SupabaseService, private seo: SeoService, private demandSvc: DemandService) {
    seo.setPage(
      'AI Car Valuation',
      'Get an instant AI-powered fair market valuation for your used car — free, no sign-up needed.',
    );
  }

  form = {
    make: '', model: '', variant: '', year: new Date().getFullYear(),
    km: '', fuel: '', transmission: '', owners: '', condition: '',
  };

  makes = Object.keys(CATALOGUE).concat(['Other']);
  fuels = ['Petrol', 'Diesel', 'Electric', 'CNG', 'Hybrid'];
  transmissions = ['Manual', 'Automatic', 'AMT', 'CVT', 'DCT'];
  ownerOptions = ['1st Owner', '2nd Owner', '3rd Owner', '4th+ Owner'];
  conditions = ['Excellent', 'Good', 'Fair', 'Needs Work'];
  get years() {
    const y: number[] = [];
    for (let i = new Date().getFullYear(); i >= 2000; i--) y.push(i);
    return y;
  }

  get availableModels(): string[] {
    return this.form.make && CATALOGUE[this.form.make] ? Object.keys(CATALOGUE[this.form.make]) : [];
  }

  get availableVariants(): Variant[] {
    if (!this.form.make || !this.form.model) return [];
    return CATALOGUE[this.form.make]?.[this.form.model] ?? [];
  }

  onMakeChange() { this.form.model = ''; this.form.variant = ''; }
  onModelChange() { this.form.variant = ''; }

  loading = signal(false);
  /**
   * Years as strings. The custom dropdown stores text, and `form.year` is read
   * back with `+` throughout, so nothing downstream notices.
   */
  yearOptions(): string[] {
    return this.years.map(String);
  }

  /**
   * Variants keep their price in the label and their bare name as the value —
   * the valuation engine matches on the name.
   */
  variantOptions(): SelectOption[] {
    return this.availableVariants.map(v => ({
      value: v.name,
      label: `${v.name} · ${this.fmt(v.basePrice)}`,
    }));
  }

  result = signal<ValuationResult | null>(null);

  /**
   * The platform's observed time-to-sell, when it has one.
   *
   * Null until it loads, and null forever if too few cars have sold — the
   * pricing card renders differently in that case rather than quoting a
   * waiting time it cannot stand behind.
   */
  daysTurn = signal<DaysTurn | null>(null);
  /** Why the AI call failed, when it did. Shown in the fallback banner. */
  fallbackReason = signal<string | null>(null);
  step = signal<'form' | 'result'>('form');

  get formValid() {
    return this.form.make && this.form.model && this.form.year && this.form.km
      && this.form.fuel && this.form.owners && this.form.condition;
  }

  async estimate() {
    if (!this.formValid) return;
    this.loading.set(true);
    this.fallbackReason.set(null);

    try {
      const { data, error } = await this.supabase.client.functions.invoke('ai-valuation', {
        body: { ...this.form },
      });

      if (error || !data || data.error) {
        throw new Error(error?.message || data?.error || 'Unknown');
      }

      // Edge returns method:'claude'; ensure field is present
      this.result.set({ ...(data as ValuationResult), method: data.method ?? 'claude' });
      this.step.set('result');
      void this.demandSvc.daysTurn().then(t => this.daysTurn.set(t));
    } catch (err) {
      // Swallowing this made "AI engine unavailable" impossible to diagnose:
      // an undeployed function, a missing API key and a rate limit all looked
      // identical. Keep the honest fallback, but say why it happened.
      const reason = err instanceof Error ? err.message : String(err);
      console.error('AI valuation unavailable — falling back to the depreciation model:', reason);
      this.fallbackReason.set(reason);
      this.result.set(computeHeuristicValuation({ ...this.form }));
      this.step.set('result');
      void this.demandSvc.daysTurn().then(t => this.daysTurn.set(t));
    } finally {
      this.loading.set(false);
    }
  }

  reset() {
    this.step.set('form');
    this.result.set(null);
    this.fallbackReason.set(null);
    this.form = { make: '', model: '', variant: '', year: new Date().getFullYear(), km: '', fuel: '', transmission: '', owners: '', condition: '' };
  }

  fmt(p: number) { return p >= 100000 ? `₹${(p / 100000).toFixed(1)}L` : `₹${p.toLocaleString('en-IN')}`; }
}
