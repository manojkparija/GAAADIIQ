/**
 * A failed submission must say what failed.
 *
 * Reported from production: "Failed to submit listing. Please try again."
 *
 * That message discarded the error entirely, and its advice was wrong. This
 * screen inserts column names straight into Supabase — bypassing the API and
 * the ORM — so the usual cause is a column the live schema does not have, and
 * that rejects the row identically every time. Trying again cannot help.
 *
 * Postgres already says exactly what is wrong ('column "km" of relation
 * "cars" does not exist', code 42703). The whole defect was throwing that
 * away.
 *
 * These assert the *content* of the message. A test that only checked
 * submitError() was non-empty would have passed on the broken screen.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { ListCarComponent } from './list-car.component';

describe('ListCarComponent — reporting a failed submission', () => {
  let fixture: ComponentFixture<ListCarComponent>;
  let c: any;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ListCarComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ListCarComponent);
    c = fixture.componentInstance;
  });

  it('names the missing column, and does not advise trying again', () => {
    const msg = c.describeSubmitFailure({
      code: '42703',
      message: 'column "km" of relation "cars" does not exist',
    });

    expect(msg).toContain('km');
    expect(msg).toContain('42703');
    // The old message's advice was actively misleading for this case.
    expect(msg).toContain('will not help');
  });

  it('reports a missing table the same way', () => {
    const msg = c.describeSubmitFailure({
      code: '42P01', message: 'relation "cars" does not exist',
    });
    expect(msg).toContain('42P01');
    expect(msg).toContain('will not help');
  });

  it('distinguishes a missing required value', () => {
    const msg = c.describeSubmitFailure({
      code: '23502', message: 'null value in column "city" violates not-null constraint',
    });
    expect(msg).toContain('city');
    expect(msg).toContain('23502');
    // This one is the seller's to fix, so it must not tell them to give up.
    expect(msg).not.toContain('will not help');
  });

  it('still says something useful for an error it does not recognise', () => {
    const msg = c.describeSubmitFailure({ message: 'network unreachable' });
    expect(msg).toContain('network unreachable');
  });

  it('does not claim a reason when the database gave none', () => {
    const msg = c.describeSubmitFailure(null);
    expect(msg).toContain('no reason');
    // Inventing a plausible cause here would be worse than admitting none.
    expect(msg).not.toContain('42703');
  });

  it('renders the real reason on the page', async () => {
    // The error block lives on step 4, where the submission happens — putting
    // the component anywhere else tests a screen the message never reaches.
    c.step.set(4);
    c.submitError.set('Could not save the listing [42703]: column "km" does not exist');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // A message the template never shows is the same silence as before.
    expect(fixture.nativeElement.textContent).toContain('42703');
  });

  /**
   * The other half: the listing saved, but its photographs did not.
   *
   * Both follow-up inserts had their results discarded — not even checked — so
   * a listing with no pictures looked exactly like one that worked, and the
   * seller found out by looking at their own advert later.
   */
  it('shows a warning on the success screen without calling the listing failed', async () => {
    c.submitted.set(true);
    c.submitWarning.set('Your listing was created, but photographs could not be saved with it.');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Listing Submitted');       // still a success
    expect(text).toContain('photographs could not be saved');
    expect(c.submitError()).toBe('');                  // and not an error
  });
});
