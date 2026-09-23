/**
 * The gearbox and fuel filters see the trims, not just the catalogue row.
 *
 * Reported: on New Cars, Body Type = Hatchback plus Transmission = Automatic
 * showed nothing, though the S-Presso has automatic trims.
 *
 * Measured in production at the time — every S-Presso catalogue row records
 * transmission "manual", while three published trims record "Automatic":
 *
 *     VXi Plus AMT   Automatic   published
 *     VXi+ (O) AMT   Automatic   published
 *     VXi AMT        Automatic   published
 *
 * The grid filtered on the row's single value, because that was the only
 * transmission the API told it about. A listing card holds one catalogue row
 * and never fetches that row's trims, so the API now sends the set —
 * variant_transmissions and variant_fuels, published trims only.
 *
 * A model filtered out of a grid is indistinguishable from a model that does
 * not exist, which is why this reads as "the car is missing" rather than as
 * "the filter is wrong".
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { NewCarsComponent } from './new-cars.component';
import { CarsDataService } from '../../services/cars-data.service';

const PHOTO = 'https://cdn.gaadiiq.test/s-presso/front.webp';

/** The S-Presso as the API actually describes it. */
function sPresso(over: Partial<any> = {}): any {
  return {
    id: 'sp-2026', make: 'Maruti Suzuki', model: 'S-Presso', year: 2026,
    price: 530000, km: 0,
    fuel: 'Petrol', transmission: 'Manual',
    variantTransmissions: ['Manual', 'Automatic'],
    variantFuels: ['Petrol', 'CNG'],
    badge: '', badgeType: '', image: PHOTO, images: [PHOTO],
    rating: 0, reviews: 0, verified: true, bodyType: 'Hatchback',
    isSellerListing: false, variantCount: 16,
    ...over,
  };
}

function mountWith(cars: any[]) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [NewCarsComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { queryParams: {} } } },
      { provide: CarsDataService, useValue: { cars: signal(cars), loading: signal(false), failedSources: signal([]) } },
    ],
  });
  return TestBed.createComponent(NewCarsComponent).componentInstance as any;
}

describe('NewCarsComponent — filtering on what the trims offer', () => {
  it('finds an automatic the catalogue row does not mention', () => {
    const c = mountWith([sPresso()]);
    c.selectedTransmissions.set(['Automatic']);

    expect(c.newCarModels().map((m: any) => m.model)).toEqual(['S-Presso']);
  });

  it('finds it alongside the body type, as reported', () => {
    // Hatchback + Automatic together — the exact combination that showed
    // "No photographs yet".
    const c = mountWith([sPresso()]);
    c.selectedBodyTypes.set(['Hatchback']);
    c.selectedTransmissions.set(['Automatic']);

    expect(c.newCarModels().length).toBe(1);
  });

  it('still finds it on the gearbox its row does carry', () => {
    const c = mountWith([sPresso()]);
    c.selectedTransmissions.set(['Manual']);

    expect(c.newCarModels().length).toBe(1);
  });

  it('finds a fuel only a trim offers', () => {
    // Same defect, same fix: the row says Petrol and a published trim is CNG.
    const c = mountWith([sPresso()]);
    c.selectedFuels.set(['CNG']);

    expect(c.newCarModels().length).toBe(1);
  });

  it('does not invent a gearbox the model has nowhere', () => {
    // The point of the filter. A model surfacing under every tick would be a
    // worse bug than the one being fixed — the reader could not trust any of
    // it — so this is the half a careless widening would break.
    const c = mountWith([sPresso()]);
    c.selectedTransmissions.set(['DCT']);

    expect(c.newCarModels()).toEqual([]);
  });

  it('falls back to the row when a model has no trims recorded', () => {
    // A model nobody has entered trims for still has to be findable, so the
    // row's own value stays in the set rather than being replaced by it.
    const c = mountWith([
      sPresso({ variantTransmissions: [], variantFuels: [], variantCount: 0 }),
    ]);
    c.selectedTransmissions.set(['Manual']);

    expect(c.newCarModels().length).toBe(1);
  });

  it('survives an older API build that sends neither field', () => {
    // Version skew: the frontend deploys on Vercel in a minute and the API on
    // Render in several, so the browser runs this code against the previous
    // API for a while. Undefined must not throw or empty the grid.
    const { variantTransmissions, variantFuels, ...legacy } = sPresso();
    const c = mountWith([legacy]);
    c.selectedTransmissions.set(['Manual']);

    expect(c.newCarModels().length).toBe(1);
  });
});

/**
 * A bi-fuel trim answers the fuel chip for both of its fuels.
 *
 * REPORTED, with a screenshot: Fuel = CNG on New Cars showed "0 models
 * available" over a catalogue of nine, most of them cars Maruti sells with
 * CNG.
 *
 * The trim's fuel is free text. The admin screen's own field is an `<input>`
 * whose placeholder reads "Petrol, Petrol + CNG…" — so the product asks for
 * both fuels in one string, and the grid then compared that string to the
 * chip with `===`. "Petrol + CNG" is not "CNG", so ticking CNG removed
 * precisely the models that have it.
 *
 * The screenshot shows which branch ran: the message was "No photographs
 * yet", not "No models found", so one photo-less model whose fuel is the bare
 * word "CNG" did match. The filter was never dead — it was strict, which is
 * worse, because it looked like an empty catalogue instead of a bug.
 */
describe('NewCarsComponent — a fuel chip matches a trim that lists two fuels', () => {
  it('finds a model whose trim reads "Petrol + CNG"', () => {
    // THE REPORTED BUG, in the form the admin screen asks admins to type.
    const c = mountWith([sPresso({ variantFuels: ['Petrol', 'Petrol + CNG'] })]);
    c.selectedFuels.set(['CNG']);

    expect(c.newCarModels().map((m: any) => m.model)).toEqual(['S-Presso']);
  });

  it('still finds it when the fuel is the bare word', () => {
    // The value that did match before, which must go on matching.
    const c = mountWith([sPresso({ variantFuels: ['Petrol', 'CNG'] })]);
    c.selectedFuels.set(['CNG']);

    expect(c.newCarModels().length).toBe(1);
  });

  it('reads the separators people actually type', () => {
    for (const written of ['Petrol/CNG', 'Petrol, CNG', 'Petrol-CNG', 'petrol + cng']) {
      const c = mountWith([sPresso({ variantFuels: [written] })]);
      c.selectedFuels.set(['CNG']);

      expect(c.newCarModels().length)
        .withContext(`a trim entered as "${written}" was filtered out`)
        .toBe(1);
    }
  });

  it('does not hand CNG a petrol-only model', () => {
    // The other half. A filter that matches everything is as useless as one
    // that matches nothing, and harder to notice.
    const c = mountWith([sPresso({ fuel: 'Petrol', variantFuels: ['Petrol'] })]);
    c.selectedFuels.set(['CNG']);

    expect(c.newCarModels().length).toBe(0);
  });

  it('treats the Electric body-type chip the same way', () => {
    // isElectric compared with === 'electric' on the same free-text value, so
    // a trim written "Electric (BEV)" failed the Electric chip too.
    const c = mountWith([
      sPresso({ model: 'e Vitara', bodyType: 'SUV', variantFuels: ['Electric (BEV)'] }),
    ]);
    c.selectedBodyTypes.set(['Electric']);

    expect(c.newCarModels().map((m: any) => m.model)).toEqual(['e Vitara']);
  });
});
