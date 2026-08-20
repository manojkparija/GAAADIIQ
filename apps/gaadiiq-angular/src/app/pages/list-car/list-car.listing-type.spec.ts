/**
 * Listing a new car rather than a resale.
 *
 * This form wrote `badge: 'Used', badge_type: 'used'` on every listing it ever
 * created, hardcoded, and asked Kilometres, Number of Owners and Car Condition
 * unconditionally. A dealer with showroom stock therefore either could not
 * list it, or listed a brand-new car as second-hand with an invented owner
 * count and mileage — figures indistinguishable from measured ones once
 * stored.
 *
 * The API has modelled `listing_type: new | used` all along, and the app
 * already queries both. Only the form could not say which.
 *
 * These cover the switch itself, because the failure worth preventing is a
 * quiet one: a seller who fills in the used fields, changes their mind, and
 * submits a "new" car still carrying 45,000 km.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { ListCarComponent } from './list-car.component';

describe('ListCarComponent — new or used', () => {
  let c: ListCarComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ListCarComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    c = TestBed.createComponent(ListCarComponent).componentInstance;
  });

  it('treats a listing as a resale unless told otherwise', () => {
    // The safer default: most listings are resales, and a used car mislabelled
    // new is a worse error than the reverse.
    expect(c.isNew()).toBeFalse();
  });

  it('clears the resale fields when switching to a new car', () => {
    c.form.km = '45000';
    c.form.owners = '2nd Owner';
    c.form.condition = 'Good';

    c.setListingType('new');

    expect(c.form.km).toBe('');
    expect(c.form.owners).toBe('');
    expect(c.form.condition).toBe('');
  });

  it('drops a valuation carried over from the used form', () => {
    // A depreciation estimate belongs to a car that has been driven. Left in
    // place it would price unregistered stock as a resale.
    c.valuation.set({ low: 1, mid: 2, high: 3, confidence: 80 } as any);
    c.setListingType('new');
    expect(c.valuation()).toBeNull();
  });

  it('clears the ex-showroom price when switching back to used', () => {
    c.form.exShowroomPrice = '850000';
    c.setListingType('used');
    expect(c.form.exShowroomPrice).toBe('');
  });

  it('does not run a valuation for a new car', async () => {
    // fetchValuation would throw on the unmocked fetch if it ran; reaching
    // step 2 with no valuation is the assertion.
    c.setListingType('new');
    c.form.make = 'Maruti Suzuki';
    c.form.model = 'Swift';

    await c.nextStep();

    expect(c.valuation()).toBeNull();
    expect(c.step()).toBe(2);
  });

  it('still moves through the steps for a new car', () => {
    c.setListingType('new');
    expect(c.step()).toBe(1);
  });
});

describe('ListCarComponent — leaving step 1', () => {
  let c: ListCarComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ListCarComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    c = TestBed.createComponent(ListCarComponent).componentInstance;
  });

  it('lets a new-car listing continue once it has a price', () => {
    // Reported from UAT as "it is not moving forward": the Continue button
    // required km, owners and condition unconditionally, and those are the
    // three fields a new car hides and clears. It could never enable.
    c.setListingType('new');
    c.form.make = 'Maruti Suzuki';
    c.form.model = 'Fronx';
    c.form.fuel = 'Petrol';
    c.form.exShowroomPrice = '785000';

    expect(c.canLeaveStepOne()).toBeTrue();
  });

  it('does not ask a new car for mileage, owners or condition', () => {
    c.setListingType('new');
    c.form.make = 'Maruti Suzuki';
    c.form.model = 'Fronx';
    c.form.fuel = 'Petrol';
    c.form.exShowroomPrice = '785000';
    c.form.km = '';
    c.form.owners = '';
    c.form.condition = '';

    expect(c.canLeaveStepOne()).toBeTrue();
  });

  it('holds a new car back until the ex-showroom price is entered', () => {
    c.setListingType('new');
    c.form.make = 'Maruti Suzuki';
    c.form.model = 'Fronx';
    c.form.fuel = 'Petrol';

    expect(c.canLeaveStepOne()).toBeFalse();
  });

  it('still asks a used car for mileage, owners and condition', () => {
    c.setListingType('used');
    c.form.make = 'Maruti Suzuki';
    c.form.model = 'Swift';
    c.form.fuel = 'Petrol';

    expect(c.canLeaveStepOne()).toBeFalse();

    c.form.km = '45000';
    c.form.owners = '1st Owner';
    c.form.condition = 'Good';
    expect(c.canLeaveStepOne()).toBeTrue();
  });

  it('waits while a valuation is being fetched', () => {
    c.setListingType('used');
    c.form.make = 'Maruti Suzuki';
    c.form.model = 'Swift';
    c.form.fuel = 'Petrol';
    c.form.km = '45000';
    c.form.owners = '1st Owner';
    c.form.condition = 'Good';
    c.valuationLoading.set(true);

    expect(c.canLeaveStepOne()).toBeFalse();
  });
});

describe('ListCarComponent — typing a variant', () => {
  let c: ListCarComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ListCarComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    c = TestBed.createComponent(ListCarComponent).componentInstance;
    c.form.make = 'Maruti Suzuki';
    c.form.model = 'Swift';
  });

  it('offers a way out of the list', () => {
    // The trim map does not cover every model, and the field used to be
    // disabled outright when it had nothing to offer.
    const values = c.variantOptions().map(o => o.value);
    expect(values).toContain(c.VARIANT_OTHER);
  });

  it('still offers the known trims', () => {
    const labels = c.variantOptions().map(o => o.label);
    expect(labels).toContain('VXi');
  });

  it('switches to a text box when the trim is not listed', () => {
    c.onVariantPick(c.VARIANT_OTHER);

    expect(c.customVariant()).toBeTrue();
    // Cleared, so the sentinel is never stored as the trim name.
    expect(c.form.variant).toBe('');
  });

  it('stores a chosen trim as itself', () => {
    c.onVariantPick('ZXi');
    expect(c.form.variant).toBe('ZXi');
    expect(c.customVariant()).toBeFalse();
  });

  it('drops back to the list when the model changes', () => {
    c.onVariantPick(c.VARIANT_OTHER);
    c.onModelChange();

    expect(c.customVariant()).toBeFalse();
    expect(c.form.variant).toBe('');
  });
});
