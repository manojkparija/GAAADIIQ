/**
 * Typing a model the list does not have.
 *
 * Reported: choosing a manufacturer and finding the model absent left only
 * 'Other'. Picking it stored the literal string "Other" as the model name.
 *
 * That is worse than refusing the listing, because it succeeds. Images resolve
 * onto catalogue cars by make + model + year, all three exact
 * (services/media_library.py), and New Cars and search match the same way — so
 * a car filed under model "Other" is one no buyer finds and no photograph
 * attaches to. The seller sees a successful submission and an advert that goes
 * nowhere.
 *
 * modelCatalogue is a hardcoded map covering a fraction of what each
 * manufacturer sells (Maruti Suzuki: 16 of them), so this is the common case,
 * not an edge one.
 *
 * The variant field below already solved this. Model now does the same.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { ListCarComponent } from './list-car.component';

describe('ListCarComponent — entering a model not in the list', () => {
  let fixture: ComponentFixture<ListCarComponent>;
  let c: any;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ListCarComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ListCarComponent);
    c = fixture.componentInstance;
    c.form.make = 'Maruti Suzuki';
  });

  it('no longer offers a literal "Other" that would be stored as the model', () => {
    expect(c.availableModels).not.toContain('Other');
  });

  it('offers a way out of the list', () => {
    const labels = c.modelOptions().map((o: any) => o.label);
    expect(labels.some((l: string) => l.includes('Type a different model'))).toBe(true);
  });

  it('switches to a text field, and does not store the sentinel as a model', () => {
    c.onModelPick(c.MODEL_OTHER);

    expect(c.customModel()).toBe(true);
    // The sentinel is a UI token. Storing it would be the old bug wearing a
    // different string.
    expect(c.form.model).toBe('');
    expect(c.form.model).not.toBe(c.MODEL_OTHER);
  });

  it('keeps what the seller types', () => {
    c.onModelPick(c.MODEL_OTHER);
    c.form.model = 'e Vitara';
    expect(c.form.model).toBe('e Vitara');
    expect(c.customModel()).toBe(true);
  });

  it('renders a text input once the seller opts to type', async () => {
    c.onModelPick(c.MODEL_OTHER);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input[name="modelText"]');
    expect(input).withContext('no text field to type the model into').toBeTruthy();
  });

  it('still stores a normal pick as the model', () => {
    c.onModelPick('Swift');
    expect(c.form.model).toBe('Swift');
    expect(c.customModel()).toBe(false);
  });

  it('clears a typed model when the make changes', () => {
    c.onModelPick(c.MODEL_OTHER);
    c.form.model = 'Something Bespoke';

    c.onMakeChange();

    // A model typed for one manufacturer must not survive onto another.
    expect(c.form.model).toBe('');
    expect(c.customModel()).toBe(false);
  });

  it('resets the variant when the model is retyped', () => {
    c.onModelPick('Swift');
    c.form.variant = 'VXi';

    c.onModelPick(c.MODEL_OTHER);

    expect(c.form.variant).toBe('');
    expect(c.customVariant()).toBe(false);
  });

  it('a typed model satisfies the step-one check like any other', () => {
    c.setListingType('new');
    c.onModelPick(c.MODEL_OTHER);
    c.form.model = 'e Vitara';
    c.form.fuel = 'Electric';
    c.form.exShowroomPrice = '1799000';

    expect(c.canLeaveStepOne()).toBe(true);
    expect(c.stepOneBlocker()).toBeNull();
  });
});
