/**
 * Removing a wrong catalogue row from the page it is wrong on.
 *
 * The cards on the New Cars variant page are catalogue rows, not trims — the
 * name rendered is `variant || model`. So a Fronx row whose `variant` reads
 * "Sigma" appears as its own "Sigma" card beside the Fronx, and four duplicate
 * Fronx rows appear as four cards.
 *
 * Admin → Variants can remove a car, but its picker shows the model and year:
 * two rows that both read "Fronx 2026" are indistinguishable there, and the one
 * an admin picks takes the real Fronx and its fourteen trims. Hence a control
 * on the card itself, where which row is which is obvious.
 *
 * The API is the gate (`Depends(get_admin_user)`); `isAdmin()` here only decides
 * whether to offer the control. Both are tested: a buyer must never see it, and
 * a click must never navigate — the card is a routerLink.
 */
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { ListingsComponent } from './listings.component';
import { CarsDataService } from '../../services/cars-data.service';
import { AuthService } from '../../services/auth.service';
import { environment } from '../../../environments/environment';

const SIGMA: any = {
  id: 'car-sigma', make: 'Maruti Suzuki', model: 'Fronx', variant: 'Sigma',
  year: 2026, price: 685000, km: 0, fuel: 'Petrol', transmission: 'Manual',
};

function build(admin: { isAdmin: boolean; localOnly?: boolean }) {
  TestBed.resetTestingModule();
  const reloaded = { count: 0 };
  TestBed.configureTestingModule({
    imports: [ListingsComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: CarsDataService,
        useValue: {
          cars: signal([SIGMA]),
          loading: signal(false),
          reload: async () => { reloaded.count += 1; },
        },
      },
      {
        provide: AuthService,
        useValue: {
          isAdmin: () => admin.isAdmin,
          isLocalOnly: () => admin.localOnly ?? false,
          currentUser: signal(null),
        },
      },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
      },
    ],
  });
  const c = TestBed.createComponent(ListingsComponent).componentInstance as any;
  return { c, http: TestBed.inject(HttpTestingController), reloaded };
}

/** A click that would navigate if the handler did not stop it. */
function clickEvent() {
  return {
    stopped: false, prevented: false,
    stopPropagation() { this.stopped = true; },
    preventDefault() { this.prevented = true; },
  } as any;
}

describe('ListingsComponent — who sees the remove control', () => {
  it('offers it to an admin', () => {
    expect(build({ isAdmin: true }).c.isAdmin()).toBeTrue();
  });

  it('never offers it to a buyer', () => {
    expect(build({ isAdmin: false }).c.isAdmin()).toBeFalse();
  });

  it('does not offer it on a browser-only session', () => {
    // The dev sign-in produces a session with no Supabase token behind it, so
    // the app looks signed in and the API answers 401. Offering a delete that
    // cannot succeed is the same fault as the broadcast button that could not
    // reach anyone.
    expect(build({ isAdmin: true, localOnly: true }).c.isAdmin()).toBeFalse();
  });
});

describe('ListingsComponent — removing a row', () => {
  it('asks before doing anything', () => {
    const { c, http } = build({ isAdmin: true });

    c.askRemove(SIGMA, clickEvent());

    expect(c.confirmRemoveId()).toBe('car-sigma');
    http.expectNone(`${environment.apiUrl}/cars/car-sigma`);
  });

  it('never navigates: the card is a routerLink', () => {
    const { c } = build({ isAdmin: true });
    const ask = clickEvent();
    const cancel = clickEvent();

    c.askRemove(SIGMA, ask);
    c.cancelRemove(cancel);

    expect(ask.stopped).toBeTrue();
    expect(ask.prevented).toBeTrue();
    expect(cancel.stopped).toBeTrue();
    expect(c.confirmRemoveId()).toBeNull();
  });

  it('deletes the row it was shown against, and refreshes', async () => {
    const { c, http, reloaded } = build({ isAdmin: true });

    const done = c.removeCar(SIGMA, clickEvent());
    http.expectOne({ url: `${environment.apiUrl}/cars/car-sigma`, method: 'DELETE' })
      .flush(null, { status: 204, statusText: 'No Content' });
    await done;

    expect(reloaded.count).toBe(1);
    expect(c.confirmRemoveId()).toBeNull();
    expect(c.removeError()).toBeNull();
  });

  it('shows the reason when a seller has advertised against it', async () => {
    // The 409's detail names how many listings are in the way. Replacing it
    // with "something went wrong" would leave the admin no way forward.
    const { c, http, reloaded } = build({ isAdmin: true });

    const done = c.removeCar(SIGMA, clickEvent());
    http.expectOne(`${environment.apiUrl}/cars/car-sigma`).flush(
      { detail: '2 listing(s) still point at this car. Remove those listings first.' },
      { status: 409, statusText: 'Conflict' },
    );
    await done;

    expect(c.removeError()).toContain('2 listing(s)');
    expect(reloaded.count).withContext('nothing was removed').toBe(0);
  });

  it('says to sign in when the API refuses the caller', async () => {
    const { c, http } = build({ isAdmin: true });

    const done = c.removeCar(SIGMA, clickEvent());
    http.expectOne(`${environment.apiUrl}/cars/car-sigma`)
      .flush(null, { status: 403, statusText: 'Forbidden' });
    await done;

    expect(c.removeError()).toContain('admin');
  });

  it('names the row the way the card does', () => {
    // "Remove Maruti Suzuki Fronx Sigma 2026?" — the variant is what tells two
    // otherwise identical Fronx rows apart.
    const { c } = build({ isAdmin: true });

    expect(c.cardName(SIGMA)).toBe('Maruti Suzuki Fronx Sigma 2026');
    expect(c.cardName({ ...SIGMA, variant: null })).toBe('Maruti Suzuki Fronx 2026');
  });
});
