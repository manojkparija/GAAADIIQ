/**
 * What the Browse page's model grid does about a model with no photograph.
 *
 * IT USED TO HIDE IT. IT NOW SHOWS IT, MARKED.
 *
 * Both behaviours came from a real report, which is why this file has been
 * rewritten rather than deleted:
 *
 *   - blanks reading "No Image Available" across the grid looked like a broken
 *     page (the original report, below);
 *   - hiding the model made a catalogue of seven show one, and "← Back to all
 *     models" led to a list containing a single car.
 *
 * The two only conflict if the choice is between hiding a model and showing a
 * broken-looking card. It is not: the grid has a deliberate treatment — a car
 * silhouette carrying the model's name and "Photographs coming soon" — which
 * was unreachable, because `image` holds PLACEHOLDER rather than being empty
 * and PLACEHOLDER is truthy, so the <img> branch always won.
 *
 * So the rule these pin is unchanged in substance: NOTHING stands in for a
 * photograph the car does not have. No bundled drawing, no other model year's
 * picture, no third-party URL. The model is now listed rather than dropped,
 * and it is listed as having no picture.
 *
 * The original report follows, because the reasoning still applies.
 *
 * Reported against "Explore New Cars": e Vitara, Fronx and Grand Vitara all
 * sat there reading "No Image Available", and their images are not in the
 * database — measured, all three have zero rows in vehicle_media and
 * car_images.
 *
 * The same rule already applies to /new-cars. This page has its own
 * newCarModels() and was missed, so the two grids disagreed about the same
 * catalogue: one hid a model with no picture, the other showed it as a blank.
 *
 * It carried the same two defects the New Cars grid had, and they are fixed
 * here for the same reasons:
 *
 *   - the representative was chosen with `c.image`, which is always truthy
 *     because mapCatalogueCar substitutes a placeholder, so the first row won
 *     even when a later model year had photographs;
 *   - a bundled Swift drawing stood in for a missing photograph, so deleting
 *     every image for a Swift left a picture on screen.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { ListingsComponent } from './listings.component';
import { CarsDataService, PLACEHOLDER } from '../../services/cars-data.service';

const PHOTO = 'https://cdn.gaadiiq.test/s-presso/front.webp';

function car(over: Partial<any> = {}): any {
  return {
    id: `id-${over['model'] ?? 'x'}-${over['year'] ?? 2026}`,
    make: 'Maruti Suzuki', model: 'S-Presso', year: 2026,
    price: 530000, km: 0,
    fuel: 'Petrol', transmission: 'Manual',
    badge: '', badgeType: '', image: PLACEHOLDER, images: [PLACEHOLDER],
    rating: 0, reviews: 0, verified: true, bodyType: 'Hatchback',
    isSellerListing: false, variantCount: 16,
    ...over,
  };
}

function mountWith(cars: any[]) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ListingsComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { queryParams: {} } } },
      { provide: CarsDataService, useValue: { cars: signal(cars), loading: signal(false), failedSources: signal([]) } },
    ],
  });
  return TestBed.createComponent(ListingsComponent).componentInstance as any;
}

describe('ListingsComponent — the Explore New Cars model grid', () => {
  it('lists a model with no photograph, marked as having none', () => {
    // e Vitara, Fronx and Grand Vitara, exactly as reported — all three on the
    // grid now, none of them claiming a picture it does not have.
    const c = mountWith([
      car({ model: 'e Vitara', price: 1599000 }),
      car({ model: 'Fronx', price: 684000 }),
      car({ model: 'S-Presso', image: PHOTO, images: [PHOTO] }),
    ]);

    const byModel = Object.fromEntries(
      c.newCarModels().map((m: any) => [m.model, m.image]),
    );
    expect(Object.keys(byModel).sort()).toEqual(['Fronx', 'S-Presso', 'e Vitara']);
    expect(byModel['e Vitara']).toBe(PLACEHOLDER);
    expect(byModel['Fronx']).toBe(PLACEHOLDER);
    expect(byModel['S-Presso']).toBe(PHOTO);
  });

  it('still lists the model when none has a photograph', () => {
    // The catalogue is not empty, so the page must not read as though it is.
    // That was the second report: one model shown out of seven.
    const c = mountWith([car({ model: 'Fronx', price: 684000 })]);

    expect(c.newCarModels().length).toBe(1);
    expect(c.newCarModels()[0].image).toBe(PLACEHOLDER);
  });

  it('takes the photograph from the model year that has one', () => {
    // The rep picker treated a placeholder as a photograph, so the earliest
    // row won and the card showed a blank while a later year had pictures.
    const c = mountWith([
      car({ model: 'Fronx', year: 2024, price: 899000 }),
      car({ model: 'Fronx', year: 2026, price: 930000, image: PHOTO, images: [PHOTO] }),
    ]);

    const [m] = c.newCarModels();
    expect(m.image).toBe(PHOTO);
  });

  it('does not keep a bundled drawing for a Swift with no photographs', () => {
    // The database is the only source. A Swift whose images were deleted must
    // read like any other model rather than keeping a picture — it is listed,
    // with the placeholder, not with a drawing that ships in the bundle.
    const c = mountWith([car({ model: 'Swift', price: 649000 })]);

    expect(c.newCarModels()[0].image).toBe(PLACEHOLDER);
  });

  it('shows an uploaded Swift photograph when there is one', () => {
    const swift = 'https://cdn.gaadiiq.test/swift/front.webp';
    const c = mountWith([
      car({ model: 'Swift', price: 649000, image: swift, images: [swift] }),
    ]);

    expect(c.newCarModels()[0].image).toBe(swift);
  });

  it('does not treat an aeplcdn URL as a photograph', () => {
    // Those are a third party's and frequently dead; a broken image tag is
    // worse than an honest absence. The model is listed, with the placeholder
    // rather than the borrowed URL.
    const aepl = 'https://imgd.aeplcdn.com/s-presso.jpg';
    const c = mountWith([car({ image: aepl, images: [aepl] })]);

    expect(c.newCarModels()[0].image).toBe(PLACEHOLDER);
  });
});
