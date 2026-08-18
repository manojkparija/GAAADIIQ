import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../components/icon/icon.component';
import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';
import { CarVariant } from '../../services/cars-data.service';
import { environment } from '../../../environments/environment';
import { CustomSelectComponent, SelectOption } from '../../components/custom-select/custom-select.component';

/** A vehicle the catalogue holds, as the picker offers it. */
interface CatalogueCar {
  id: string;
  make: string;
  model: string;
  year: number;
  ex_showroom_price: string | null;
}

/** A trim being edited. Everything is a string: it came from a form. */
interface VariantForm {
  name: string;
  ex_showroom_price: string;
  fuel_type: string;
  transmission: string;
  engine_cc: string;
  seating_capacity: string;
  mileage: string;
  features: string;
}

const EMPTY_FORM: VariantForm = {
  name: '', ex_showroom_price: '', fuel_type: '', transmission: '',
  engine_cc: '', seating_capacity: '', mileage: '', features: '',
};

/**
 * Maintain the trims a model is sold in.
 *
 * These were a hardcoded map in the car detail page covering seven models.
 * Every other model showed no variants at all, and no admin action could
 * change it — a price a buyer budgets against lived in a component.
 *
 * Research drafts the list with a language model, which will state a plausible
 * price with complete confidence. So drafts are marked as such and published
 * only when someone has read them. A published figure is one a person vouched
 * for; that is the whole point of the two states.
 */
@Component({
  selector: 'app-admin-variants',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent, CustomSelectComponent],
  templateUrl: './admin-variants.component.html',
  styleUrls: ['./admin-variants.component.scss'],
})
export class AdminVariantsComponent {
  private supabase = inject(SupabaseService);
  private apiUrl = environment.apiUrl;

  cars = signal<CatalogueCar[]>([]);

  /** Model list as {value: id, label: "Model (year)"} for the dropdown. */
  modelSelectOptions(): SelectOption[] {
    return this.modelsForMake().map(car => ({
      value: String(car.id),
      label: `${car.model} (${car.year})`,
    }));
  }

  selectedCarId = signal('');
  variants = signal<CarVariant[]>([]);

  loading = signal(false);
  researching = signal(false);
  error = signal('');
  toastMsg = signal('');

  /** The row being edited, or 'new' for the add form. */
  editingId = signal<string | null>(null);
  form = signal<VariantForm>({ ...EMPTY_FORM });

  makeOptions = computed(() =>
    [...new Set(this.cars().map(c => c.make))].sort()
  );
  selectedMake = signal('');
  modelsForMake = computed(() =>
    this.cars()
      .filter(c => c.make === this.selectedMake())
      .sort((a, b) => a.model.localeCompare(b.model) || b.year - a.year)
  );

  selectedCar = computed(() =>
    this.cars().find(c => c.id === this.selectedCarId()) ?? null
  );

  drafts = computed(() => this.variants().filter(v => v.status === 'draft'));
  published = computed(() => this.variants().filter(v => v.status === 'published'));

  constructor(auth: AuthService, router: Router) {
    if (!auth.isAdmin()) {
      router.navigate(['/']);
      return;
    }
    void this.loadCars();
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const { data } = await this.supabase.client.auth.getSession();
    const token = data.session?.access_token ?? '';
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private toast(msg: string) {
    this.toastMsg.set(msg);
    setTimeout(() => this.toastMsg.set(''), 4000);
  }

  private async loadCars() {
    this.loading.set(true);
    try {
      // Unpriced models included on purpose: a model with no price is exactly
      // the one whose trims nobody has entered yet.
      const resp = await fetch(`${this.apiUrl}/cars?page=1&page_size=100`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this.cars.set((await resp.json()).items ?? []);
    } catch (err) {
      this.error.set(`Could not load the catalogue: ${err}`);
    } finally {
      this.loading.set(false);
    }
  }

  onMakeChange(make: string) {
    this.selectedMake.set(make);
    this.selectedCarId.set('');
    this.variants.set([]);
  }

  async onCarChange(carId: string) {
    this.selectedCarId.set(carId);
    this.cancelEdit();
    if (carId) await this.loadVariants();
  }

  async loadVariants() {
    const carId = this.selectedCarId();
    if (!carId) return;
    this.loading.set(true);
    this.error.set('');
    try {
      // include_drafts: this screen is where drafts get read, so it is the one
      // caller that must see them.
      const resp = await fetch(
        `${this.apiUrl}/cars/${carId}/variants?include_drafts=true`,
        { headers: await this.authHeaders() },
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this.variants.set(await resp.json());
    } catch (err) {
      this.error.set(String(err));
    } finally {
      this.loading.set(false);
    }
  }

  async research() {
    const carId = this.selectedCarId();
    if (!carId) return;
    this.researching.set(true);
    this.error.set('');
    try {
      const resp = await fetch(`${this.apiUrl}/cars/${carId}/variants/research`, {
        method: 'POST',
        headers: await this.authHeaders(),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const drafted: CarVariant[] = await resp.json();
      await this.loadVariants();
      this.toast(
        drafted.length
          ? `📝 ${drafted.length} trim(s) drafted — check each price before publishing`
          : 'Nothing new found. Trims already recorded are left alone.'
      );
    } catch (err) {
      this.error.set(`Research failed: ${err}`);
    } finally {
      this.researching.set(false);
    }
  }

  /**
   * Draft the model's specification and feature list.
   *
   * Separate from trim research because it answers a different question — what
   * the car is, rather than what you can buy — and fills the Specs and
   * Features tabs, which read "haven't been added yet" for every model until
   * somebody fills them.
   */
  researchingDetails = signal(false);

  async researchDetails() {
    const carId = this.selectedCarId();
    if (!carId) return;
    this.researchingDetails.set(true);
    try {
      const resp = await fetch(`${this.apiUrl}/cars/${carId}/research-details`, {
        method: 'POST',
        headers: await this.authHeaders(),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const car = await resp.json();
      const specs = car.specs?.length ?? 0;
      const features = car.features?.length ?? 0;
      // Two failures look identical from here — the AI returning nothing, and
      // the write not landing — so say which one this was. A toast that reads
      // "nothing found" when the car came back empty sends the next person
      // looking at the prompt instead of at the database.
      this.toast(
        specs || features
          ? `📋 ${specs} specification(s) and ${features} feature(s) saved`
          : 'The AI returned no specification for this model. Nothing was saved.'
      );
    } catch (err) {
      this.error.set(`Specification research failed: ${err}`);
    } finally {
      this.researchingDetails.set(false);
    }
  }

  startAdd() {
    this.editingId.set('new');
    this.form.set({ ...EMPTY_FORM });
  }

  startEdit(v: CarVariant) {
    this.editingId.set(v.id);
    this.form.set({
      name: v.name,
      ex_showroom_price: v.ex_showroom_price ?? '',
      fuel_type: v.fuel_type ?? '',
      transmission: v.transmission ?? '',
      engine_cc: v.engine_cc?.toString() ?? '',
      seating_capacity: v.seating_capacity?.toString() ?? '',
      mileage: v.mileage ?? '',
      features: (v.features ?? []).join(', '),
    });
  }

  /**
   * Update one form field.
   *
   * A template cannot spread an object, and giving each field its own signal
   * would be eight signals to keep in step with one row being edited.
   */
  setField(key: keyof VariantForm, value: string) {
    this.form.set({ ...this.form(), [key]: value });
  }

  cancelEdit() {
    this.editingId.set(null);
    this.form.set({ ...EMPTY_FORM });
  }

  /**
   * Form strings to a request body.
   *
   * Blank means "no value", sent as null rather than as an empty string: a
   * trim with no recorded mileage is different from one whose mileage is "".
   */
  private body(): Record<string, unknown> {
    const f = this.form();
    const orNull = (s: string) => (s.trim() ? s.trim() : null);
    const numOrNull = (s: string) => (s.trim() ? Number(s) : null);
    return {
      name: f.name.trim(),
      ex_showroom_price: orNull(f.ex_showroom_price),
      fuel_type: orNull(f.fuel_type),
      transmission: orNull(f.transmission),
      engine_cc: numOrNull(f.engine_cc),
      seating_capacity: numOrNull(f.seating_capacity),
      mileage: orNull(f.mileage),
      features: f.features.split(',').map(s => s.trim()).filter(Boolean),
    };
  }

  async save() {
    const carId = this.selectedCarId();
    const editing = this.editingId();
    if (!carId || !editing || !this.form().name.trim()) return;

    const isNew = editing === 'new';
    try {
      const resp = await fetch(
        isNew
          ? `${this.apiUrl}/cars/${carId}/variants`
          : `${this.apiUrl}/cars/${carId}/variants/${editing}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { ...(await this.authHeaders()), 'Content-Type': 'application/json' },
          body: JSON.stringify(this.body()),
        },
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      this.cancelEdit();
      await this.loadVariants();
      this.toast(isNew ? '✅ Trim added' : '✅ Trim updated');
    } catch (err) {
      this.error.set(`Could not save: ${err}`);
    }
  }

  async publish(v: CarVariant) {
    await this.patchStatus(v, 'published', '✅ Published — buyers can see it now');
  }

  async unpublish(v: CarVariant) {
    await this.patchStatus(v, 'draft', '👁 Hidden from buyers');
  }

  private async patchStatus(v: CarVariant, status: 'draft' | 'published', msg: string) {
    try {
      const resp = await fetch(
        `${this.apiUrl}/cars/${this.selectedCarId()}/variants/${v.id}`,
        {
          method: 'PATCH',
          headers: { ...(await this.authHeaders()), 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await this.loadVariants();
      this.toast(msg);
    } catch (err) {
      this.error.set(String(err));
    }
  }

  async publishAllDrafts() {
    const drafts = this.drafts();
    if (!drafts.length) return;
    // Deliberately still one click per screen rather than per trim, but named
    // for what it does: an admin who has read the list should not have to
    // click ten times to say so.
    if (!confirm(
      `Publish all ${drafts.length} draft trim(s)?\n\n` +
      'They become visible to buyers. Only do this once you have read the prices.'
    )) return;

    for (const v of drafts) {
      await this.patchStatus(v, 'published', '');
    }
    this.toast(`✅ ${drafts.length} trim(s) published`);
  }

  async remove(v: CarVariant) {
    if (!confirm(`Delete "${v.name}"? This cannot be undone.`)) return;
    try {
      const resp = await fetch(
        `${this.apiUrl}/cars/${this.selectedCarId()}/variants/${v.id}`,
        { method: 'DELETE', headers: await this.authHeaders() },
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await this.loadVariants();
      this.toast('🗑 Trim deleted');
    } catch (err) {
      this.error.set(String(err));
    }
  }

  formatPrice(value: string | null): string {
    if (!value) return 'No price';
    const n = Number(value);
    return n >= 100000 ? `₹${(n / 100000).toFixed(2)} Lakh` : `₹${n.toLocaleString('en-IN')}`;
  }
}
