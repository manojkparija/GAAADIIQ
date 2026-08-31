/**
 * "Get this fixed" → Authorised centres.
 *
 * Reported from the live site: a driver in New Town, Kolkata opened the modal
 * and was shown Salt Lake at 4.9 km, then Popular Maruti in Hyderabad at
 * 1,193 km and Competent Automobiles in Delhi at 1,325 km — three entries
 * because the list always took the nearest three in the country, with no
 * notion of whether any of them were reachable. Each row carries a tel: link,
 * so the failure mode is a stranded driver phoning another state.
 *
 * These drive the component's own bookService(), with geolocation stubbed, so
 * they exercise the shipped selection rather than a copy of it.
 */

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { VehicleDiagnosisComponent } from './vehicle-diagnosis.component';

// New Town, Kolkata — the reporter's location.
const NEW_TOWN = { latitude: 22.5804, longitude: 88.4646 };

describe('VehicleDiagnosisComponent authorised centres', () => {
  let component: any;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [VehicleDiagnosisComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    component = TestBed.createComponent(VehicleDiagnosisComponent).componentInstance;
  });

  /**
   * Run bookService() as if the browser reported `coords`.
   *
   * Awaited: bookService() now goes through NativeService, which asks Android
   * for the location permission before reading a fix and is therefore async.
   * On the web that still ends at navigator.geolocation, so these stubs are
   * unchanged -- but the result no longer exists by the next statement.
   */
  const at = async (coords: { latitude: number; longitude: number }) => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: any) => ok({ coords }) },
    });
    await component.bookService();
    return component.nearbyServiceCenters();
  };

  /** Run bookService() as if the user refused the location prompt. */
  const denied = async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok: any, fail: any) => fail({ code: 1 }) },
    });
    await component.bookService();
    return component.nearbyServiceCenters();
  };

  it('never offers a centre in another city', async () => {
    component.form.manufacturer = 'Maruti Suzuki';
    const centres = await at(NEW_TOWN);

    // The exact rows from the report.
    const names = centres.map((c: any) => c.name);
    expect(names).not.toContain('Popular Maruti');        // Hyderabad, 1,193 km
    expect(names).not.toContain('Competent Automobiles'); // Delhi, 1,325 km

    for (const c of centres) {
      expect(c.distance)
        .withContext(`${c.name} is ${c.distance} km away — not reachable today`)
        .toBeLessThanOrEqual(60);
    }
  });

  it('still offers the centre that really is nearby', async () => {
    // Suppressing the far ones must not empty the list of the good one.
    component.form.manufacturer = 'Maruti Suzuki';
    const names = (await at(NEW_TOWN)).map((c: any) => c.name);
    expect(names).toContain('Mandve Motors Kolkata');
  });

  it('shows nothing rather than Mumbai when the city is unlisted', async () => {
    // The fallback used to return the first city in the table — Mumbai — for
    // anywhere not listed, which is a wrong answer dressed as a right one.
    component.form.manufacturer = 'Maruti Suzuki';
    component.city.selectedCity.set('Guwahati');
    expect(await denied()).toEqual([]);
  });

  it('lists the local centre when the city is known and location is refused', async () => {
    component.form.manufacturer = 'Maruti Suzuki';
    component.city.selectedCity.set('New Town');
    expect((await denied()).map((c: any) => c.name)).toContain('Mandve Motors Kolkata');
  });
});
