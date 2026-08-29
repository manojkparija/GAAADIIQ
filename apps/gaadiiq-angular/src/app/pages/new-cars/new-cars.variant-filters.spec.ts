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
