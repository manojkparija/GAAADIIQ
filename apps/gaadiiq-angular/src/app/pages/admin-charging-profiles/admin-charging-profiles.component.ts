import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { SeoService } from '../../services/seo.service';
import { ChargingProfile, EvChargingService } from '../../services/ev-charging.service';

/**
 * Entering what each EV can accept (BRD §5, §22).
 *
 * Typed in from the manufacturer's brochure, never inferred. Every figure here
 * feeds a charging-time estimate somebody plans a journey around, so a guessed
 * max_dc_kw is not a placeholder — it is a wrong answer to "can I get to Puri
 * on one stop", delivered with a straight face.
 *
 * `source_note` exists for that reason. When a driver reports that a figure is
 * wrong, the only way to settle it is to know where it came from.
 */
@Component({
  selector: 'app-admin-charging-profiles',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  templateUrl: './admin-charging-profiles.component.html',
  styleUrl: './admin-charging-profiles.component.scss',
})
export class AdminChargingProfilesComponent {
  private readonly api = inject(EvChargingService);

  readonly acConnectors = ['type2', 'type1', 'bharat_ac_001', 'three_pin'];
  readonly dcConnectors = ['ccs2', 'chademo', 'bharat_dc_001'];

  profiles = signal<ChargingProfile[]>([]);
  loading = signal(false);
  saving = signal(false);
  error = signal<string | null>(null);
  saved = signal<string | null>(null);

  // The form. Plain fields, bound with ngModel.
  form: Partial<ChargingProfile> = this.blank();

  constructor(seo: SeoService) {
    seo.setPage('EV charging profiles', 'Battery capacity, connectors and charging limits per model.');
    this.load();
  }

  private blank(): Partial<ChargingProfile> {
    return {
      make: '', model: '', variant: '',
      battery_capacity_kwh: null, usable_battery_capacity_kwh: null,
      ac_connector: 'type2', max_ac_kw: null,
      dc_connector: 'ccs2', max_dc_kw: null,
      source_note: '',
    };
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.profiles.set(await this.api.adminProfiles());
    } catch {
      this.error.set('Could not load charging profiles.');
      this.profiles.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  edit(p: ChargingProfile) {
    this.form = { ...p };
    this.saved.set(null);
    this.error.set(null);
  }

  reset() {
    this.form = this.blank();
    this.saved.set(null);
    this.error.set(null);
  }

  /**
   * A method, not a computed(): the form fields are plain and bound with
   * ngModel, and computed() tracks signal reads only — over a plain field it
   * evaluates once and is stale for ever. CLAUDE.md records that having
   * shipped twice.
   */
  problem(): string | null {
    if (!this.form.make?.trim() || !this.form.model?.trim()) {
      return 'Make and model are required.';
    }
    const gross = this.form.battery_capacity_kwh;
    const usable = this.form.usable_battery_capacity_kwh;
    // Caught here as well as by a check constraint. A usable figure above the
    // pack is a transcription slip, and it would shorten every estimate for
    // that car — worth stopping before it reaches a driver.
    if (gross != null && usable != null && usable > gross) {
      return 'Usable capacity cannot be larger than the total battery capacity.';
    }
    if (!this.form.source_note?.trim()) {
      return 'Please record where these figures came from — a driver disputing one cannot be answered otherwise.';
    }
    return null;
  }

  async save() {
    const problem = this.problem();
    if (problem) { this.error.set(problem); return; }

    this.saving.set(true);
    this.error.set(null);
    try {
      const out = await this.api.saveProfile(this.form);
      this.saved.set(`${out.make} ${out.model} saved.`);
      this.form = this.blank();
      await this.load();
    } catch (err: any) {
      const detail = err?.error?.detail;
      this.error.set(typeof detail === 'string' ? detail : 'Could not save that profile.');
    } finally {
      this.saving.set(false);
    }
  }

  label(p: ChargingProfile): string {
    return [p.make, p.model, p.variant].filter(Boolean).join(' ');
  }

  /** What is missing on an existing row, so gaps are visible at a glance. */
  gaps(p: ChargingProfile): string[] {
    const out: string[] = [];
    if (!p.usable_battery_capacity_kwh && !p.battery_capacity_kwh) out.push('battery');
    if (!p.max_dc_kw) out.push('DC limit');
    if (!p.max_ac_kw) out.push('AC limit');
    if (!p.source_note) out.push('source');
    return out;
  }
}
