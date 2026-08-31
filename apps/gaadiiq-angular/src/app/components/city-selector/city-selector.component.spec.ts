/**
 * "Select city as per current location" did nothing on Android.
 *
 * detectLocation() called navigator.geolocation.getCurrentPosition directly.
 * Inside an Android WebView that never triggers the runtime permission
 * request — ACCESS_FINE_LOCATION is declared in AndroidManifest.xml, but on
 * Android 6+ declaring is not granting, and nothing in this component asked.
 * The error callback then reported
 *
 *     Location access denied. Please select a city manually.
 *
 * telling the driver they had refused a permission they were never offered.
 *
 * NativeService.getCurrentPosition() is the path that asks. It was written for
 * exactly this fault and adopted only in marketplace.service.ts; the city
 * picker, the EV charging map and the diagnosis service-centre lookup were all
 * left calling the browser API directly.
 *
 * The two failures are also told apart now. "I cannot find you" and "I found
 * you but cannot name the place" send someone to completely different
 * settings screens, and only one of them is about location at all.
 */
import { TestBed } from '@angular/core/testing';

import { CitySelectorComponent } from './city-selector.component';
import { CityService } from '../../services/city.service';
import { NativeService } from '../../services/native.service';

const FIX = { coords: { latitude: 22.5726, longitude: 88.3639, accuracy: 20 } } as any;

function build(native: Partial<NativeService>, city: Partial<CityService> = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CitySelectorComponent],
    providers: [
      { provide: NativeService, useValue: native },
      {
        provide: CityService,
        useValue: { setCity: jasmine.createSpy('setCity'), selectedCity: () => 'Kolkata', ...city },
      },
    ],
  });
  return TestBed.createComponent(CitySelectorComponent).componentInstance as any;
}

function stubReverseGeocode(city: string | null) {
  spyOn(window, 'fetch').and.returnValue(
    city === null
      ? Promise.reject(new Error('offline'))
      : Promise.resolve({ json: () => Promise.resolve({ address: { city } }) } as any),
  );
}

describe('CitySelectorComponent — detecting the city', () => {
  it('asks the platform for the position instead of the browser API', async () => {
    // The fix. On Android this is the only call that requests the permission.
    const native = { getCurrentPosition: jasmine.createSpy('getCurrentPosition').and.resolveTo(FIX) };
    stubReverseGeocode('Kolkata');
    const c = build(native as any);

    await c.detectLocation();

    expect(native.getCurrentPosition).toHaveBeenCalled();
  });

  it('sets the city it resolved and closes', async () => {
    const setCity = jasmine.createSpy('setCity');
    stubReverseGeocode('Kolkata');
    const c = build({ getCurrentPosition: () => Promise.resolve(FIX) } as any, { setCity });
    const closed = spyOn(c.closed, 'emit');

    await c.detectLocation();

    expect(setCity).toHaveBeenCalledWith('Kolkata');
    expect(closed).toHaveBeenCalled();
  });

  it('does not blame the user when the position could not be read', async () => {
    // The reported message. A permission that was never requested cannot have
    // been denied, and telling someone to un-deny it sends them nowhere.
    const c = build({
      getCurrentPosition: () => Promise.reject(new Error('Location permission was not granted.')),
    } as any);

    await c.detectLocation();

    expect(c.locationError()).toContain('location is on for GAADIIQ');
    expect(c.locationError()).not.toContain('denied');
  });

  it('treats a null fix as a failure, not as a location', async () => {
    // NativeService returns GeolocationPosition | null.
    const c = build({ getCurrentPosition: () => Promise.resolve(null) } as any);

    await c.detectLocation();

    expect(c.locationError()).toBeTruthy();
  });

  it('separates "cannot locate you" from "cannot name the place"', async () => {
    // Different remedies: one is a permission, the other is the network. The
    // old code reported the second as the first.
    stubReverseGeocode(null);
    const c = build({ getCurrentPosition: () => Promise.resolve(FIX) } as any);

    await c.detectLocation();

    expect(c.locationError()).toContain('which city');
    expect(c.locationError()).not.toContain('location is on');
  });

  it('stops the spinner on every path', async () => {
    // A spinner left running is what "not working" looks like from outside.
    const c = build({ getCurrentPosition: () => Promise.reject(new Error('no')) } as any);

    await c.detectLocation();

    expect(c.locating()).toBeFalse();
  });

  it('falls back to a sensible name when the address has no city', async () => {
    const setCity = jasmine.createSpy('setCity');
    spyOn(window, 'fetch').and.resolveTo({
      json: () => Promise.resolve({ address: { village: 'Baruipur' } }),
    } as any);
    const c = build({ getCurrentPosition: () => Promise.resolve(FIX) } as any, { setCity });

    await c.detectLocation();

    expect(setCity).toHaveBeenCalledWith('Baruipur');
  });

  it('picking a city from the list is unaffected', async () => {
    const setCity = jasmine.createSpy('setCity');
    const c = build({ getCurrentPosition: () => Promise.resolve(FIX) } as any, { setCity });
    const closed = spyOn(c.closed, 'emit');

    c.select('Bhubaneswar');

    expect(setCity).toHaveBeenCalledWith('Bhubaneswar');
    expect(closed).toHaveBeenCalled();
  });
});
