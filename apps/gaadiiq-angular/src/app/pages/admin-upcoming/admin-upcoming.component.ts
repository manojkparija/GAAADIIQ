import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { UpcomingCar, UpcomingCarsService } from '../../services/upcoming-cars.service';

interface UpcomingForm {
  make: string;
  model: string;
  expected_on: string;
  expected_price_min: string;
  expected_price_max: string;
  body_type: string;
  fuel_type: string;
  image_url: string;
}

const EMPTY: UpcomingForm = {
  make: '', model: '', expected_on: '',
  expected_price_min: '', expected_price_max: '',
  body_type: '', fuel_type: '', image_url: '',
};

/**
 * Maintain the Upcoming Cars strip.
 *
 * The strip was a hardcoded array of five entries in the New Cars component,
 * with the expected date as free text ("Q3 2026") and nothing that ever
 * removed one. A car stayed under "Upcoming" after it launched, and correcting
 * that took a code change and a deploy — which is to say it did not happen:
 * four of the five were on sale when it was reported.
 *
 * What is "upcoming" changes every few weeks by definition, so of everything
 * on that page it is the entry least able to survive being a literal.
 *
 * Retiring is the everyday action here, not deleting. "On sale now" keeps the
 * row and takes the car off the strip; a delete is for something that should
 * never have been entered.
 */
@Component({
  selector: 'app-admin-upcoming',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-upcoming.component.html',
  styleUrls: ['./admin-upcoming.component.scss'],
})
export class AdminUpcomingComponent {
  private service = inject(UpcomingCarsService);

  cars = this.service.cars;
  loading = this.service.loading;
  error = signal('');
  toastMsg = signal('');

  editingId = signal<string | null>(null);
  form = signal<UpcomingForm>({ ...EMPTY });

  /**
   * Still on the strip, and already off it — shown apart.
   *
   * A launched car has to stay visible here: a launch marked by mistake is
   * otherwise invisible to the person who has to undo it.
   */
  live = computed(() => this.cars().filter(c => this.isLive(c)));
  retired = computed(() => this.cars().filter(c => !this.isLive(c)));

  isLive(car: UpcomingCar): boolean {
    return car.is_active
      && !car.launched_at
      && car.expected_on >= new Date().toISOString().slice(0, 10);
  }

  /** Why a car is off the strip, in the admin's words. */
  retiredReason(car: UpcomingCar): string {
    if (car.launched_at) return 'On sale';
    if (!car.is_active) return 'Hidden';
    return 'Date passed';
  }

  constructor(auth: AuthService, router: Router) {
    if (!auth.isAdmin()) {
      router.navigate(['/']);
      return;
    }
    void this.reload();
  }

  /** include_past: this screen manages the retired rows as well. */
  async reload(): Promise<void> {
    await this.service.load(true);
    if (this.service.failed()) this.error.set('Could not load the list.');
  }

  private toast(msg: string): void {
    this.toastMsg.set(msg);
    setTimeout(() => this.toastMsg.set(''), 4000);
  }

  /**
   * Set one form field.
   *
   * A method rather than `form.set({ ...form(), x: $event })` in the template:
   * Angular's template parser has no spread syntax, and the compiler rejects
   * it outright rather than at runtime.
   */
  setField(key: keyof UpcomingForm, value: string): void {
    this.form.set({ ...this.form(), [key]: value });
  }

  startAdd(): void {
    this.editingId.set('new');
    this.form.set({ ...EMPTY });
  }

  startEdit(car: UpcomingCar): void {
    this.editingId.set(car.id);
    this.form.set({
      make: car.make,
      model: car.model,
      expected_on: car.expected_on,
      // String(): these arrive as JSON numbers or NUMERIC strings depending on
      // the field, and a form input needs a string either way. The variants
      // editor crashed on exactly this — .trim() called on a number.
      expected_price_min: car.expected_price_min == null ? '' : String(car.expected_price_min),
      expected_price_max: car.expected_price_max == null ? '' : String(car.expected_price_max),
      body_type: car.body_type ?? '',
      fuel_type: car.fuel_type ?? '',
      image_url: car.image_url ?? '',
    });
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.form.set({ ...EMPTY });
  }

  /** The form as the API wants it: blanks become null, not "". */
  private body(): Record<string, unknown> {
    const f = this.form();
    const text = (v: string) => (v.trim() === '' ? null : v.trim());
    const money = (v: string) => (v.trim() === '' ? null : Number(v));
    return {
      make: f.make.trim(),
      model: f.model.trim(),
      expected_on: f.expected_on,
      expected_price_min: money(f.expected_price_min),
      expected_price_max: money(f.expected_price_max),
      body_type: text(f.body_type),
      fuel_type: text(f.fuel_type),
      image_url: text(f.image_url),
    };
  }

  async save(): Promise<void> {
    const id = this.editingId();
    if (!id) return;
    this.error.set('');
    try {
      if (id === 'new') await this.service.create(this.body());
      else await this.service.update(id, this.body());
      this.cancelEdit();
      await this.reload();
      this.toast('Saved');
    } catch (err) {
      this.error.set(`Could not save: ${`${err}`.replace(/^Error:\s*/, '')}`);
    }
  }

  /** The everyday action: the car is on sale, take it off the strip. */
  async markLaunched(car: UpcomingCar): Promise<void> {
    await this.patch(car, { launched: true }, `${car.model} marked as on sale`);
  }

  async undoLaunched(car: UpcomingCar): Promise<void> {
    await this.patch(car, { launched: false }, `${car.model} is upcoming again`);
  }

  async setActive(car: UpcomingCar, is_active: boolean): Promise<void> {
    await this.patch(car, { is_active }, is_active ? 'Shown again' : 'Hidden from the site');
  }

  private async patch(car: UpcomingCar, body: Record<string, unknown>, msg: string) {
    this.error.set('');
    try {
      await this.service.update(car.id, body);
      await this.reload();
      this.toast(msg);
    } catch (err) {
      this.error.set(`${err}`.replace(/^Error:\s*/, ''));
    }
  }

  async remove(car: UpcomingCar): Promise<void> {
    // Deleting loses the record that the car was ever announced, which is why
    // the button says so and why "On sale" is offered first.
    if (!confirm(`Delete ${car.make} ${car.model}? Marking it as on sale keeps the record.`)) return;
    this.error.set('');
    try {
      await this.service.remove(car.id);
      await this.reload();
      this.toast('Deleted');
    } catch (err) {
      this.error.set(`${err}`.replace(/^Error:\s*/, ''));
    }
  }
}
