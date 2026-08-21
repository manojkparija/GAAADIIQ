/**
 * The Edit button on a trim opens the form with that trim's values in it.
 *
 * Written to chase a report that price "is not editable through the edit
 * button". It did not reproduce: clicking the real button populates every
 * field, price included. Kept because the path has broken before — a priced
 * trim once crashed the form with `a.trim is not a function`, since the API
 * types the price Decimal and Pydantic sends it as a JSON number.
 *
 * NOTE ON THE FIRST VERSION OF THIS SPEC, which reported a bug that was not
 * there: NgModel writes to the DOM in a deferred microtask, so
 * detectChanges() alone leaves every input empty however correct the binding
 * is. The `await fixture.whenStable()` below is what makes the assertions
 * mean anything; without it this file asserts a falsehood confidently.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AdminVariantsComponent } from './admin-variants.component';
import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';
import { signal } from '@angular/core';

describe('admin-variants — Edit button', () => {
  let fixture: ComponentFixture<AdminVariantsComponent>;
  let comp: AdminVariantsComponent;

  const trim = {
    id: 'v-delta-plus',
    car_id: 'c-fronx-2026',
    name: 'Delta+',
    ex_showroom_price: 872500,        // a NUMBER, as Pydantic sends it
    fuel_type: 'Petrol',
    transmission: 'Manual',
    engine_cc: 1197,
    seating_capacity: 5,
    mileage: '21.79 km/l',
    features: ['LED Multi-Reflector Headlamps'],
    status: 'draft' as const,
    source: 'ai' as const,
    sort_order: 4,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminVariantsComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { isAdmin: () => true, currentUser: signal({ email: 'admin@gaadiiq.com', name: 'A' }) } },
        { provide: SupabaseService, useValue: { client: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminVariantsComponent);
    comp = fixture.componentInstance;
    // Put the component in the state the screenshot shows: a car chosen and its
    // trims listed. Bypasses the network entirely.
    // The whole panel is gated on selectedCar(), which resolves selectedCarId
    // against cars() — so both have to be populated, not just the id.
    comp.cars.set([{ id: 'c-fronx-2026', make: 'Maruti Suzuki', model: 'Fronx', year: 2026, ex_showroom_price: '930000.00' }]);
    comp.selectedCarId.set('c-fronx-2026');
    comp.variants.set([trim as any]);
    fixture.detectChanges();
  });

  it('renders an Edit button for the trim', () => {
    const buttons: HTMLButtonElement[] =
      Array.from(fixture.nativeElement.querySelectorAll('button'));
    const edit = buttons.filter(b => b.textContent?.trim() === 'Edit');
    expect(edit.length).toBeGreaterThan(0);
  });

  it('opens the form with the price filled in when Edit is clicked', async () => {
    const buttons: HTMLButtonElement[] =
      Array.from(fixture.nativeElement.querySelectorAll('button'));
    const edit = buttons.find(b => b.textContent?.trim() === 'Edit');
    expect(edit).withContext('no Edit button rendered').toBeTruthy();

    edit!.click();
    fixture.detectChanges();
    // NgModel writes its value to the DOM in a deferred microtask, so
    // detectChanges() alone leaves every input empty in a test even when the
    // binding is perfectly correct. Without this the spec reports a false bug.
    await fixture.whenStable();
    fixture.detectChanges();

    expect(comp.editingId()).toBe('v-delta-plus');
    // The price must arrive as a string the form can hold, not a number.
    expect(comp.form().ex_showroom_price).toBe('872500');

    const inputs: HTMLInputElement[] =
      Array.from(fixture.nativeElement.querySelectorAll('.av-form input'));
    expect(inputs.length).withContext('form did not render after Edit').toBeGreaterThan(0);

    // The rendered value, not just the model: the point of this spec is that
    // the price reaches the DOM, which is what "not editable" would mean.
    const priceInput = inputs.find(i => i.getAttribute('type') === 'number');
    expect(priceInput!.value).toBe('872500');

    // The other fields too — when this broke it broke for all of them at once,
    // and checking only the price would have made that look price-specific.
    expect(inputs[0].value).toBe('Delta+');
  });

  it('accepts a typed price', () => {
    comp.startEdit(trim as any);
    fixture.detectChanges();

    comp.setField('ex_showroom_price', '900000');
    fixture.detectChanges();

    expect(comp.form().ex_showroom_price).toBe('900000');
  });
});
