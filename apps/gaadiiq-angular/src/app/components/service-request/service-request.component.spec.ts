/**
 * AI Diagnosis → Find Mechanic → Send the request.
 *
 * Reported as "the flow is not working". Two faults in the same screen, both
 * of which look like the feature being broken rather than the network being
 * empty:
 *
 *   1. The ⚡ broadcast was offered as the PRIMARY action, above the list,
 *      unconditionally. Where no partner mechanic is registered, the screen
 *      said "No GAADIIQ partner mechanics are registered near you yet" and
 *      directly above it invited the driver to send the job to those same
 *      nonexistent mechanics. The API answers that with 503.
 *
 *   2. Pressing it created the service request FIRST and dispatched second, so
 *      the 503 arrived after the row was written. The driver saw an error and
 *      was left with an open job in their history that no mechanic was ever
 *      told about and that they never knowingly raised.
 *
 * Neither is the mechanic network being empty — that is a fact about the data,
 * and it is honest for the screen to say so. These are about not inviting an
 * action that cannot succeed, and not leaving wreckage when one fails.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { ServiceRequestComponent } from './service-request.component';
import { MarketplaceService } from '../../services/marketplace.service';

const FIX = { latitude: 22.58, longitude: 88.47, accuracy_m: 20 };

const MECHANIC: any = {
  id: 'm-1', full_name: 'Rahim Auto Works', shop_name: 'Rahim Auto',
  city: 'Kolkata', area_pincode: '700135', distance_km: 1.2,
};

const CREATED: any = { id: 'sr-1', status: 'open', reference: 'GQ-1' };

function build(market: Partial<MarketplaceService>) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ServiceRequestComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MarketplaceService, useValue: market },
    ],
  });
  return TestBed.createComponent(ServiceRequestComponent).componentInstance as any;
}

function marketWith(over: Partial<Record<string, any>> = {}) {
  return {
    currentPosition: jasmine.createSpy('currentPosition').and.resolveTo(FIX),
    nearby: jasmine.createSpy('nearby').and.resolveTo([]),
    createRequest: jasmine.createSpy('createRequest').and.resolveTo(CREATED),
    dispatch: jasmine.createSpy('dispatch').and.resolveTo({ offers: [] }),
    assignMechanic: jasmine.createSpy('assignMechanic').and.resolveTo(CREATED),
    cancelRequest: jasmine.createSpy('cancelRequest').and.resolveTo(CREATED),
    startOtp: jasmine.createSpy('startOtp').and.resolveTo({ code: '1234' }),
    formatPaise: (p: number) => `₹${p / 100}`,
    ...over,
  } as any;
}

describe('ServiceRequestComponent — offering the broadcast', () => {
  it('does not offer it when the search found nobody', async () => {
    // The reported screen. Inviting a send to zero mechanics can only 503.
    const c = build(marketWith({ nearby: () => Promise.resolve([]) }));
    await c.locate();

    expect(c.mechanics().length).toBe(0);
    expect(c.canBroadcast()).withContext('nothing to broadcast to').toBeFalse();
  });

  it('offers it when mechanics were found', async () => {
    const c = build(marketWith({ nearby: () => Promise.resolve([MECHANIC]) }));
    await c.locate();

    expect(c.canBroadcast()).toBeTrue();
  });

  it('still offers it when the search itself failed', async () => {
    // A failed search is not evidence of an empty network. The server may find
    // someone; hiding the button here would remove the only way to ask.
    const c = build(marketWith({
      nearby: () => Promise.reject(new Error('network down')),
    }));
    await c.locate();

    expect(c.error()).toBeTruthy();
    expect(c.canBroadcast()).toBeTrue();
  });
});

describe('ServiceRequestComponent — a broadcast that reaches nobody', () => {
  function failingDispatch() {
    const err: any = new Error('503');
    err.status = 503;
    err.error = { detail: 'No available mechanic within 15 km right now' };
    return err;
  }

  it('withdraws the request it just created', async () => {
    // The wreckage: an open job in the customer's history, raised by a button
    // press they were told had failed.
    const market = marketWith({
      dispatch: jasmine.createSpy('dispatch').and.rejectWith(failingDispatch()),
    });
    const c = build(market);
    await c.locate();
    c.broadcastInstead();
    c.carNumber = 'WB06D2019';

    await c.submit();

    expect(market.createRequest).toHaveBeenCalled();
    expect(market.cancelRequest).toHaveBeenCalledWith('sr-1', jasmine.any(String));
  });

  it('shows the reason the server gave, not the cleanup', async () => {
    const market = marketWith({
      dispatch: jasmine.createSpy('dispatch').and.rejectWith(failingDispatch()),
    });
    const c = build(market);
    await c.locate();
    c.broadcastInstead();
    c.carNumber = 'WB06D2019';

    await c.submit();

    expect(c.error()).toContain('No available mechanic within 15 km');
  });

  it('does not move on to the waiting screen', async () => {
    // Nothing is coming, so a "waiting for a mechanic" screen would be a lie.
    const market = marketWith({
      dispatch: jasmine.createSpy('dispatch').and.rejectWith(failingDispatch()),
    });
    const c = build(market);
    await c.locate();
    c.broadcastInstead();
    c.carNumber = 'WB06D2019';

    await c.submit();

    expect(c.stage()).toBe('details');
  });

  it('still reports the original problem when the withdrawal also fails', async () => {
    // Cleanup is best-effort. The driver needs to know why their request did
    // not go out, not that a call they never made did not work either.
    const market = marketWith({
      dispatch: jasmine.createSpy('dispatch').and.rejectWith(failingDispatch()),
      cancelRequest: jasmine.createSpy('cancelRequest').and.rejectWith(new Error('offline')),
    });
    const c = build(market);
    await c.locate();
    c.broadcastInstead();
    c.carNumber = 'WB06D2019';

    await c.submit();

    expect(c.error()).toContain('No available mechanic within 15 km');
  });
});

describe('ServiceRequestComponent — the paths that already worked', () => {
  it('does not withdraw anything when the broadcast succeeds', async () => {
    const market = marketWith({ nearby: () => Promise.resolve([MECHANIC]) });
    const c = build(market);
    await c.locate();
    c.broadcastInstead();
    c.carNumber = 'WB06D2019';

    await c.submit();

    expect(market.cancelRequest).not.toHaveBeenCalled();
    expect(c.stage()).toBe('awaiting');
  });

  it('does not withdraw anything when a chosen mechanic is assigned', async () => {
    // Picking a mechanic never went through dispatch, and must be untouched.
    const market = marketWith({ nearby: () => Promise.resolve([MECHANIC]) });
    const c = build(market);
    await c.locate();
    c.choose(MECHANIC);
    c.carNumber = 'WB06D2019';

    await c.submit();

    expect(market.assignMechanic).toHaveBeenCalledWith('sr-1', 'm-1');
    expect(market.cancelRequest).not.toHaveBeenCalled();
    expect(c.stage()).toBe('awaiting');
  });

  it('still refuses a registration number that is too short', async () => {
    // The guard that runs before anything is created, unchanged.
    const market = marketWith();
    const c = build(market);
    await c.locate();
    c.broadcastInstead();
    c.carNumber = 'WB06';

    await c.submit();

    expect(market.createRequest).not.toHaveBeenCalled();
    expect(c.error()).toContain('registration number');
  });
});
