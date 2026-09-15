/**
 * The New Cars tab's count says what clicking will produce, and the models it
 * holds back are accounted for.
 *
 * REPORTED, with a screenshot: the pill read "✨ New Cars 7" and the heading
 * directly under it read "1 models available".
 *
 * BOTH NUMBERS WERE RIGHT, ABOUT DIFFERENT QUESTIONS
 *
 *   newCount      catalogue ROWS passing isShowable
 *   newCarModels  those rows GROUPED BY model, minus any model whose
 *                 representative row has no photograph
 *
 * Three differences between two numbers printed side by side — rows vs models,
 * and a photograph rule applied to one and not the other. isShowable also lets
 * a seller listing through without a picture (`fromCatalogue === false ||
 * hasPhotograph`), which the grid never would.
 *
 * WHY THE GRID STILL HIDES THEM
 *
 * Because that is a decision, not an oversight, and it came from the opposite
 * report: e Vitara, Fronx and Grand Vitara sitting on this grid reading
 * "No Image Available", with no photograph rows behind any of them. See
 * listings.model-photos.spec.ts, which pins it.
 *
 * What was actually wrong was doing it silently. Six models left the page and
 * nothing anywhere said so, so a deliberate rule read as a broken catalogue.
 * These pin both halves: the count promises the cards, and the models held
 * back are counted where a reader can see them.
 */
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';

import { ListingsComponent } from './listings.component';
import { CarsDataService, PLACEHOLDER } from '../../services/cars-data.service';
import { AuthService } from '../../services/auth.service';

const REAL = 'https://cdn.gaadiiq.test/baleno/2026/front.webp';

/** A catalogue row for a brand-new car, as mapCatalogueCar produces one. */
function car(over: Partial<any> = {}): any {
  return {
    id: `id-${over['model'] ?? 'x'}-${over['year'] ?? 2026}`,
    make: 'Maruti Suzuki', model: 'Fronx',
    year: 2026, price: 930000, km: 0,
    fuel: 'Petrol', transmission: 'Manual', badge: '', badgeType: '',
    image: PLACEHOLDER, images: [PLACEHOLDER],
    rating: 0, reviews: 0, verified: true, bodyType: 'Hatchback',
    isSellerListing: false, fromCatalogue: true, variantCount: 12,
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
      {
        provide: CarsDataService,
        useValue: { cars: signal(cars), loading: signal(false), reload: async () => {} },
      },
      {
        provide: AuthService,
        useValue: { isAdmin: () => false, isLocalOnly: () => false, currentUser: signal(null) },
      },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap({}) } },
      },
    ],
  });
  const c = TestBed.createComponent(ListingsComponent).componentInstance as any;
  c.carType.set('New');
  return c;
}

describe('ListingsComponent — the New tab counts what it shows', () => {
  it('the pill count matches the page under it', () => {
    // THE REPORTED BUG: 7 beside the label, "1 models available" beneath it.
    const c = mountWith([
      car({ model: 'Baleno', image: REAL, images: [REAL] }),
      car({ model: 'Victoris' }),
      car({ model: 'S-Presso' }),
    ]);

    expect(c.newModelCount()).toBe(c.newCarModels().length);
    expect(c.newModelCount()).toBe(1);
  });

  it('counts models, not catalogue rows', () => {
    // One model across two model-years is one card, so one card is what the
    // count promises — the rows-vs-models half of the mismatch.
    const c = mountWith([
      car({ model: 'Fronx', year: 2024, price: 899000, image: REAL, images: [REAL] }),
      car({ model: 'Fronx', year: 2026, price: 930000, image: REAL, images: [REAL] }),
    ]);

    expect(c.newModelCount()).toBe(1);
  });

  it('accounts for the models held back for want of a photograph', () => {
    // THE ONE THAT MATTERS MOST. Hiding them is the decision; hiding the fact
    // that they were hidden is the bug.
    const c = mountWith([
      car({ model: 'Baleno', image: REAL, images: [REAL] }),
      car({ model: 'Victoris' }),
      car({ model: 'S-Presso' }),
    ]);

    expect(c.modelsAwaitingPhotos()).toBe(2);
  });

  it('counts a model as waiting only when no row of it has a picture', () => {
    // A model whose 2026 row has photographs is on the grid, so it is not
    // waiting — even though its 2024 row has none.
    const c = mountWith([
      car({ model: 'Fronx', year: 2024 }),
      car({ model: 'Fronx', year: 2026, image: REAL, images: [REAL] }),
    ]);

    expect(c.modelsAwaitingPhotos()).toBe(0);
    expect(c.newModelCount()).toBe(1);
  });

  it('says nothing is waiting when every model has a picture', () => {
    // The unchanged case: a healthy catalogue gains no new message.
    const c = mountWith([
      car({ model: 'Baleno', image: REAL, images: [REAL] }),
      car({ model: 'Fronx', image: REAL, images: [REAL] }),
    ]);

    expect(c.modelsAwaitingPhotos()).toBe(0);
    expect(c.newModelCount()).toBe(2);
  });
});

describe('ListingsComponent — the All and Used tabs count what they show', () => {
  it('the All Cars count matches the list beneath it', () => {
    // REPORTED: "All Cars 8" over a page reading "1 listings found".
    // minYear defaults to 2018, so the 2010 advert is in neither.
    const c = mountWith([
      car({ model: 'Baleno', image: REAL, images: [REAL] }),
      car({ model: 'Ritz', year: 2010, km: 95000, price: 110000,
            image: REAL, images: [REAL], fromCatalogue: false, isSellerListing: true }),
    ]);
    c.carType.set('All');

    expect(c.allCount()).toBe(c.filteredCars().length);
  });

  it('a sidebar filter moves the count with the list', () => {
    // THE ONE THAT MATTERS MOST. The counts used to ignore every filter, so
    // narrowing the page left them stating the unfiltered catalogue.
    const c = mountWith([
      car({ model: 'Baleno', image: REAL, images: [REAL], fuel: 'Petrol' }),
      car({ model: 'e Vitara', image: REAL, images: [REAL], fuel: 'Electric' }),
    ]);
    c.carType.set('All');
    expect(c.allCount()).toBe(2);

    c.selectedFuel.set('Electric');

    expect(c.allCount()).toBe(1);
    expect(c.allCount()).toBe(c.filteredCars().length);
  });

  it('the Used count matches its own tab', () => {
    const c = mountWith([
      car({ model: 'Baleno', image: REAL, images: [REAL] }),
      car({ model: 'Swift', year: 2020, km: 42000, price: 550000,
            image: REAL, images: [REAL], fromCatalogue: false, isSellerListing: true }),
    ]);
    c.carType.set('Used');

    expect(c.usedCount()).toBe(c.filteredCars().length);
    expect(c.usedCount()).toBe(1);
  });

  it('an advert older than the year filter is in neither the count nor the list', () => {
    // Not a special case for 2010 — the point is that one predicate decides
    // both, so any filter that hides a car also stops counting it.
    const c = mountWith([
      car({ model: 'Ritz', year: 2010, km: 95000, price: 110000,
            image: REAL, images: [REAL], fromCatalogue: false, isSellerListing: true }),
    ]);
    c.carType.set('Used');

    expect(c.usedCount()).toBe(0);
    expect(c.filteredCars().length).toBe(0);
  });
});
