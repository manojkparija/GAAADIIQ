/**
 * A model card shows a photograph the model actually has.
 *
 * Reported: the Fronx card read "No Image Available" while the admin panel
 * listed seven photographs for Maruti Suzuki Fronx 2026, all filed correctly
 * (media_bucket 'new', not deleted, exact make/model/year).
 *
 * Nothing was wrong with the data. One card covers every model year in the
 * budget band, so it picks a representative row, and the rule was
 *
 *     inBand.find(c => c.image && !c.image.includes('aeplcdn'))
 *
 * meaning "prefer a row that has an image". But mapCatalogueCar fills `image`
 * with a placeholder for a car that has none, so every row passed and the
 * first in the band won. The band held Fronx 2024 (no photographs, ₹8.99L)
 * ahead of Fronx 2026 (seven photographs, ₹9.30L) — the API orders by year —
 * so the card rendered 2024's placeholder.
 *
 * The ₹5L–₹10L filter is what made it visible: it admitted the 2024 row
 * alongside the 2026 one. That is why these fixtures use two years in one
 * band rather than a single car.
 *
 * Not Fronx-specific: any model whose earliest in-band year lacks photographs
 * hid the ones a later year had.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { NewCarsComponent } from './new-cars.component';
import { CarsDataService, PLACEHOLDER } from '../../services/cars-data.service';

const REAL = 'https://cdn.gaadiiq.test/fronx/2026/front.webp';

/** A catalogue row as mapCatalogueCar produces one. */
function car(over: Partial<any>): any {
  return {
    id: `id-${over['year'] ?? 2026}`, make: 'Maruti Suzuki', model: 'Fronx',
    year: 2026, price: 930000, km: 0,
    fuel: 'Petrol', transmission: 'Manual', badge: '', badgeType: '',
    image: PLACEHOLDER, images: [PLACEHOLDER],
    rating: 0, reviews: 0, verified: true, bodyType: 'Hatchback',
    isSellerListing: false, variantCount: 12,
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

describe('NewCarsComponent — which photograph a model card shows', () => {
  it('uses the year that has photographs, not the cheapest year', () => {
    // Exactly the reported shape, in the order the API returns it.
    const c = mountWith([
      car({ year: 2024, price: 899000 }),
      car({ year: 2026, price: 930000, image: REAL, images: [REAL] }),
    ]);

    const [model] = c.newCarModels();
    expect(model.image)
      .withContext('the model has a photograph; the card must not claim otherwise')
      .toBe(REAL);
  });

  it('still spans the whole band in its price range', () => {
    // The representative changed; what the card says about price must not.
    const c = mountWith([
      car({ year: 2024, price: 899000 }),
      car({ year: 2026, price: 930000, image: REAL, images: [REAL] }),
    ]);

    const [model] = c.newCarModels();
    expect(model.minPrice).toBe(899000);
    expect(model.maxPrice).toBe(930000);
  });

  it('shows nothing at all when no year has one', () => {
    // A model genuinely without photographs is kept off the grid rather than
    // rendered as a blank card.
    const c = mountWith([car({ year: 2024, price: 899000 }), car({ year: 2026 })]);

    expect(c.newCarModels()).toEqual([]);
    expect(c.hiddenForNoPhoto()).toBe(1);
  });

  it('prefers a first-party photograph over an aeplcdn one', () => {
    // aeplcdn URLs are a third party's and frequently dead. That preference
    // predates this fix and must survive it.
    const aepl = 'https://imgd.aeplcdn.com/fronx.jpg';
    const c = mountWith([
      car({ year: 2024, price: 899000, image: aepl, images: [aepl] }),
      car({ year: 2026, price: 930000, image: REAL, images: [REAL] }),
    ]);

    expect(c.newCarModels()[0].image).toBe(REAL);
  });

  it('does not chase an aeplcdn URL, which never renders anyway', () => {
    // resolveImage discards aeplcdn and returns the placeholder, so treating
    // such a row as "has a photograph" would only move View Details onto a car
    // whose picture is not going to appear. The two rules have to agree.
    const aepl = 'https://imgd.aeplcdn.com/fronx.jpg';
    const c = mountWith([
      car({ year: 2024, price: 899000 }),
      car({ year: 2026, price: 930000, image: aepl, images: [aepl] }),
    ]);

    // Nothing renderable, so nothing is shown — an aeplcdn URL must not count
    // as a photograph and put a broken card back on the grid.
    expect(c.newCarModels()).toEqual([]);
    expect(c.hiddenForNoPhoto()).toBe(1);
  });

  it('shows an uploaded photograph for a Swift, not the bundled drawing', () => {
    // resolveImage returned the bundled SVG for every Swift before it looked
    // at the uploaded image at all. Photographs uploaded through the admin
    // screens could not reach the grid, and deleting them changed nothing on
    // screen — the opposite of what a delete is for.
    const swift = 'https://cdn.gaadiiq.test/swift/2026/front.webp';
    const c = mountWith([
      car({ model: 'Swift', year: 2026, price: 649000, image: swift, images: [swift] }),
    ]);

    expect(c.newCarModels()[0].image).toBe(swift);
  });

  it('keeps a model with no photograph off the grid', () => {
    // "No Image Available" on a grid of cars reads as a broken page rather
    // than a catalogue gap. Reported against the e Vitara and Grand Vitara
    // cards, which sat there as blanks.
    const c = mountWith([
      car({ model: 'e Vitara', year: 2026, price: 1600000 }),
      car({ year: 2026, price: 930000, image: REAL, images: [REAL] }),
    ]);

    const shown = c.newCarModels().map((m: any) => m.model);
    expect(shown).toEqual(['Fronx']);
  });

  it('counts what it hid, so the empty state can explain itself', () => {
    // An empty grid has two causes needing opposite responses: no model
    // matched the filters (change them) or none has a photograph (upload
    // one). One message for both sends the reader the wrong way.
    const c = mountWith([car({ model: 'e Vitara', year: 2026, price: 1600000 })]);

    expect(c.newCarModels().length).toBe(0);
    expect(c.hiddenForNoPhoto()).toBe(1);
  });

  it('reports nothing hidden when every model has a photograph', () => {
    const c = mountWith([car({ year: 2026, price: 930000, image: REAL, images: [REAL] })]);

    expect(c.newCarModels().length).toBe(1);
    expect(c.hiddenForNoPhoto()).toBe(0);
  });

  it('points View Details at the row it took the photograph from', () => {
    // Otherwise the card shows a car the detail page then has no images for,
    // which reads as the gallery being broken.
    const c = mountWith([
      car({ year: 2024, price: 899000 }),
      car({ year: 2026, price: 930000, image: REAL, images: [REAL] }),
    ]);

    expect(c.newCarModels()[0].representativeId).toBe('id-2026');
  });
});
