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
