/**
 * The Browse page's card grid and its chips agree with the model grid.
 *
 * Reported with two screenshots of the same page: "Explore New Cars — 1 models
 * available" above, and "Browse Maruti Suzuki — 8 listings found" below, seven
 * of those eight cards reading "No Image Available".
 *
 * The photograph rule reached the model grid and stopped there, so one page
 * gave two answers for one catalogue in the reader's field of view. That is
 * worse than either rule on its own, and it was introduced by fixing the model
 * grid alone.
 *
 * Adverts are exempt. A listing is a real car someone is trying to sell, and
 * hiding it for want of a photograph removes them from the marketplace; a
 * catalogue row with no picture is only an absence of data.
 *
 * isSellerListing cannot make that distinction — it is `listing_type ===
 * 'used'`, so a dealer's advert for a brand-new car reads false there too,
 * which is why `fromCatalogue` exists.
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
    isSellerListing: false, fromCatalogue: true, variantCount: 14,
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

describe('ListingsComponent — the card grid and the type chips', () => {
  it('drops a catalogue row with no photograph', () => {
    const c = mountWith([
      car({ model: 'e Vitara', price: 1600000 }),
      car({ model: 'S-Presso', image: PHOTO, images: [PHOTO] }),
    ]);

    expect(c.filteredCars().map((x: any) => x.model)).toEqual(['S-Presso']);
  });

  it('keeps an advert that has no photograph', () => {
    // A real car someone is selling. Hiding it takes them off the site.
    const c = mountWith([
      car({ model: 'Alto', fromCatalogue: false, isSellerListing: true, km: 42000, year: 2019 }),
    ]);

    expect(c.filteredCars().length).toBe(1);
  });

  it("keeps a dealer's advert for a brand-new car", () => {
    // The case isSellerListing gets wrong: listing_type 'new' means it reads
    // false, exactly like a catalogue row. Filtering on it would have hidden
    // this advert.
    const c = mountWith([
      car({ model: 'Baleno', fromCatalogue: false, isSellerListing: false, km: 0 }),
    ]);

    expect(c.filteredCars().length).toBe(1);
  });

  it('makes the New chip agree with the grid', () => {
    // The reported contradiction: "New Cars 8" beside a single card.
    const c = mountWith([
      car({ model: 'e Vitara', price: 1600000 }),
      car({ model: 'Fronx', price: 684000 }),
      car({ model: 'Grand Vitara', price: 1619000 }),
      car({ model: 'S-Presso', image: PHOTO, images: [PHOTO] }),
    ]);

    expect(c.newCount()).toBe(1);
    expect(c.filteredCars().length).toBe(1);
  });

  it('counts an advert with no photograph in the Used chip', () => {
    const c = mountWith([
      car({ model: 'Alto', fromCatalogue: false, isSellerListing: true, km: 42000, year: 2019 }),
    ]);

    expect(c.usedCount()).toBe(1);
  });

  it('treats a row from an older build as a catalogue row', () => {
    // fromCatalogue absent: undefined !== false, so the photograph rule
    // applies. The safe direction — an advert wrongly hidden is worse than a
    // blank catalogue card briefly surviving a version skew.
    const { fromCatalogue, ...legacy } = car();
    const c = mountWith([legacy]);

    expect(c.filteredCars()).toEqual([]);
  });

  it('does not accept an aeplcdn URL as a photograph', () => {
    const aepl = 'https://imgd.aeplcdn.com/s-presso.jpg';
    const c = mountWith([car({ image: aepl, images: [aepl] })]);

    expect(c.filteredCars()).toEqual([]);
  });
});
