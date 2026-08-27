/**
 * Say why Continue is disabled.
 *
 * Reported from production, on a New car with Make, Model, Variant, Year,
 * Body Type, Fuel and Transmission all filled in: "this page is not moving
 * forward".
 *
 * The rule was right — canLeaveStepOne() requires an ex-showroom price for a
 * new listing, because a new car has no valuation to fall back on. What was
 * wrong is that nothing said so. The field carried no required marker and the
 * button simply sat there greyed out, so the only way to find the requirement
 * was to guess which of nine inputs it wanted.
 *
 * These tests assert the *message*, deliberately. Asserting canLeaveStepOne()
 * alone would have passed on the broken screen: the rule was never the defect.
 *
 * The rule itself is unchanged, and the first test here pins that.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { ListCarComponent } from './list-car.component';

describe('ListCarComponent — why Continue is disabled', () => {
  let fixture: ComponentFixture<ListCarComponent>;
  let c: ListCarComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ListCarComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ListCarComponent);
    c = fixture.componentInstance;
  });

  /** Exactly the reported screen: everything filled except the price. */
  function fillReportedScreen() {
    c.setListingType('new');
    c.form.make = 'Maruti Suzuki';
    c.form.model = 'Swift';
    c.form.variant = 'VXi';
    c.form.year = 2026;
    c.form.bodyType = 'Hatchback';
    c.form.fuel = 'Petrol';
    c.form.transmission = 'Manual';
    c.form.exShowroomPrice = '';
  }

  it('still blocks a new listing with no price — the rule is unchanged', () => {
    fillReportedScreen();
    expect(c.canLeaveStepOne()).toBeFalse();
  });

  it('names the ex-showroom price as what is missing', () => {
    fillReportedScreen();
    const why = c.stepOneBlocker();
    expect(why).withContext('no reason given for the disabled button').toBeTruthy();
    expect(why).toContain('Ex-showroom price');
  });

  it('renders that reason on the page, not just in the model', () => {
    fillReportedScreen();
    fixture.detectChanges();
    // A message the template never renders is the same silence as before.
    expect(fixture.nativeElement.textContent).toContain('Ex-showroom price is needed');
  });

  it('says nothing once the price is entered, and Continue unlocks', () => {
    fillReportedScreen();
    c.form.exShowroomPrice = '850000';
    fixture.detectChanges();

    expect(c.stepOneBlocker()).toBeNull();
    expect(c.canLeaveStepOne()).toBeTrue();

    const btn = Array.from(fixture.nativeElement.querySelectorAll('button'))
      .find((b: any) => b.textContent?.includes('Continue')) as HTMLButtonElement;
    expect(btn.disabled).withContext('Continue still disabled with a price set').toBeFalse();
  });

  it('lists every missing field, not only the first', () => {
    c.setListingType('new');
    c.form.make = '';
    c.form.model = '';
    c.form.fuel = '';
    c.form.exShowroomPrice = '';

    const why = c.stepOneBlocker()!;
    for (const field of ['Make', 'Model', 'Fuel Type', 'Ex-showroom price']) {
      expect(why).withContext(`${field} not named`).toContain(field);
    }
  });

  it('names the resale fields on a used listing', () => {
    c.setListingType('used');
    c.form.make = 'Maruti Suzuki';
    c.form.model = 'Swift';
    c.form.fuel = 'Petrol';
    c.form.km = '';
    c.form.owners = '';
    c.form.condition = '';

    const why = c.stepOneBlocker()!;
    expect(why).toContain('Kilometres driven');
    expect(why).toContain('Owners');
    expect(why).toContain('Condition');
    // And not the new-car field, which this listing does not have.
    expect(why).not.toContain('Ex-showroom price');
  });

  it('stays quiet while the valuation is loading — the button already says so', () => {
    c.setListingType('used');
    c.form.make = 'Maruti Suzuki';
    c.form.model = 'Swift';
    c.form.fuel = 'Petrol';
    c.valuationLoading.set(true);

    expect(c.stepOneBlocker()).toBeNull();
  });
});
