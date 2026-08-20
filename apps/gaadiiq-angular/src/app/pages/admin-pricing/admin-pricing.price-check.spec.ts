/**
 * Warning an admin before a price is published.
 *
 * From UAT: flag an entered price that differs significantly from the market.
 * The reference is one a person recorded against the model, never one this app
 * produced — a figure the system invented would read exactly like a verified
 * one to whoever is about to publish.
 *
 * The behaviour worth pinning is the shape of the interruption. It fires once
 * and then lets the save through: an admin who knows the reference is stale
 * still has to be able to publish, and a warning that cannot be passed is one
 * people learn to route around rather than read.
 */
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { RouterTestingModule } from '@angular/router/testing';

import { AdminPricingComponent } from './admin-pricing.component';
import { AuthService } from '../../services/auth.service';
import { CarsDataService } from '../../services/cars-data.service';

const WARN = {
  has_reference: true, is_significant: true, difference: 0.77,
  reference_age_days: 19, is_stale: false,
  message: 'The entered price is 77% above the reference of ₹6,50,000. Please verify before publishing.',
};

const CLEAN = {
  has_reference: true, is_significant: false, difference: 0.01,
  reference_age_days: 3, is_stale: false, message: null,
};

const NO_REFERENCE = {
  has_reference: false, is_significant: false, difference: null,
  reference_age_days: null, is_stale: false,
  message: 'No reference price recorded for this model, so nothing was checked.',
};

/**
 * Let the promise continuation run.
 *
 * savePrice awaits the check before issuing the PATCH, so asserting on the
 * PATCH straight after flushing the check finds nothing — the continuation has
 * not run yet. This is a property of the test, not of the code.
 */
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('AdminPricingComponent — reference price check', () => {
  let c: AdminPricingComponent;
  let http: HttpTestingController;

  const row = () => ({
    id: 'car-1', make: 'Maruti Suzuki', model: 'Fronx', variant: null, year: 2026,
    price: 650000, imageCount: 2, editPrice: 1150000,
    editing: true, saving: false, error: '',
  }) as any;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminPricingComponent, RouterTestingModule],
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: { isAdmin: () => true, currentUser: () => null } },
        // A successful save refreshes the public catalogue, which fires three
        // further requests. Stubbed: this suite is about the price check, and
        // leaving them outstanding fails http.verify() for the wrong reason.
        { provide: CarsDataService, useValue: { reload: () => {} } },
      ],
    });
    c = TestBed.createComponent(AdminPricingComponent).componentInstance;
    http = TestBed.inject(HttpTestingController);
    // The constructor loads the catalogue; that request is not what is under test.
    http.match(() => true).forEach(r => r.flush({ items: [], total: 0, page: 1, page_size: 100 }));
  });

  afterEach(() => http.verify());

  it('does not save on the first press when the price is flagged', async () => {
    const r = row();
    const saving = c.savePrice(r);

    http.expectOne(req => req.url.includes('/price-check')).flush(WARN);
    await saving;

    // No PATCH went out.
    http.expectNone(req => req.method === 'PATCH');
    expect(r.priceCheck.is_significant).toBeTrue();
  });

  it('saves on the second press, so the warning can be passed', async () => {
    const r = row();
    const first = c.savePrice(r);
    http.expectOne(req => req.url.includes('/price-check')).flush(WARN);
    await first;

    const second = c.savePrice(r);
    // No second check: the admin has already been shown the warning.
    http.expectNone(req => req.url.includes('/price-check'));
    await tick();
    http.expectOne(req => req.method === 'PATCH').flush({ id: 'car-1', ex_showroom_price: '1150000' });
    await second;

    expect(r.price).toBe(1150000);
  });

  it('saves straight away when the price is close to the reference', async () => {
    const r = row();
    const saving = c.savePrice(r);

    http.expectOne(req => req.url.includes('/price-check')).flush(CLEAN);
    await tick();
    http.expectOne(req => req.method === 'PATCH').flush({ id: 'car-1', ex_showroom_price: '1150000' });
    await saving;

    expect(r.editing).toBeFalse();
  });

  it('saves when there is no reference, but records that nothing was checked', async () => {
    const r = row();
    const saving = c.savePrice(r);

    http.expectOne(req => req.url.includes('/price-check')).flush(NO_REFERENCE);
    await tick();
    http.expectOne(req => req.method === 'PATCH').flush({ id: 'car-1', ex_showroom_price: '1150000' });
    await saving;

    // Saved, and the absence is on the row rather than passed off as approval.
    expect(r.priceCheck).toBeNull();
    expect(r.price).toBe(1150000);
  });

  it('still saves when the check itself fails', async () => {
    // A check that cannot run must not trap the admin behind a warning the
    // server never produced.
    const r = row();
    const saving = c.savePrice(r);

    http.expectOne(req => req.url.includes('/price-check'))
      .flush('boom', { status: 500, statusText: 'Server Error' });
    await tick();
    http.expectOne(req => req.method === 'PATCH').flush({ id: 'car-1', ex_showroom_price: '1150000' });
    await saving;

    expect(r.price).toBe(1150000);
  });

  it('does not check anything when the price is being cleared', async () => {
    const r = row();
    r.editPrice = null;

    const saving = c.savePrice(r);
    http.expectNone(req => req.url.includes('/price-check'));
    await tick();
    http.expectOne(req => req.method === 'PATCH').flush({ id: 'car-1', ex_showroom_price: null });
    await saving;

    expect(r.price).toBeNull();
  });

  it('re-arms the warning after a successful save', async () => {
    // Otherwise the next edit of this row would publish unchecked.
    const r = row();
    const first = c.savePrice(r);
    http.expectOne(req => req.url.includes('/price-check')).flush(WARN);
    await first;

    const second = c.savePrice(r);
    await tick();
    http.expectOne(req => req.method === 'PATCH').flush({ id: 'car-1', ex_showroom_price: '1150000' });
    await second;

    expect(r.overrideWarning).toBeFalse();
    expect(r.priceCheck).toBeNull();
  });

  it('lets the admin go back and edit instead of publishing', async () => {
    const r = row();
    const saving = c.savePrice(r);
    http.expectOne(req => req.url.includes('/price-check')).flush(WARN);
    await saving;

    c.dismissPriceCheck(r);

    expect(r.priceCheck).toBeNull();
    expect(r.overrideWarning).toBeFalse();
  });
});
