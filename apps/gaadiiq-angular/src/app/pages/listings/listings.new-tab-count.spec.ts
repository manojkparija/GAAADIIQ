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
 * THE GRID NO LONGER HIDES THEM
 *
 * It did, and that came from the opposite report: e Vitara, Fronx and Grand
 * Vitara sitting on this grid reading "No Image Available", with no photograph
 * rows behind any of them. Hiding them then produced this one — a catalogue of
 * seven models showing one, and "← Back to all models" leading to a list of a
 * single car.
 *
 * Both reports are answered by a card that says what it is: a silhouette with
 * the model's name and "Photographs coming soon". See
 * listings.model-photos.spec.ts, which pins that nothing ever stands in for a
 * photograph the car has not got.
 *
 * So these pin two things: the count promises exactly the cards the grid
 * renders, and the models still awaiting a picture are counted where a reader
 * — and an admin — can see how many there are.
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
    //
    // The expected number changed from 1 to 3 when the grid stopped hiding
    // models with no photograph — which is the point of the assertion above
    // it: whatever the grid shows, the pill says that. The second assertion
    // is deliberately written in terms of the fixture rather than a constant.
    const c = mountWith([
      car({ model: 'Baleno', image: REAL, images: [REAL] }),
      car({ model: 'Victoris' }),
      car({ model: 'S-Presso' }),
    ]);

    expect(c.newModelCount()).toBe(c.newCarModels().length);
    expect(c.newModelCount()).toBe(3);
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

  it('counts the models still awaiting a photograph', () => {
    // They are on the grid; the number is what tells an admin how much of the
    // catalogue is still missing pictures.
    const c = mountWith([
      car({ model: 'Baleno', image: REAL, images: [REAL] }),
      car({ model: 'Victoris' }),
      car({ model: 'S-Presso' }),
    ]);

    // Listed on the grid, and counted so the heading can say how many still
    // need a picture.
    expect(c.modelsAwaitingPhotos()).toBe(2);
    expect(c.newCarModels().length).toBe(3);
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
    // One predicate decides both, so any filter that hides a car also stops
    // counting it.
    //
    // The year is SET here rather than relied upon: this test used to lean on
    // minYear defaulting to 2018, and that default turned out to be the next
    // bug — it hid a real 2010 advert from Browse entirely. A test that leans
    // on a default is really a test of the default.
    const c = mountWith([
      car({ model: 'Ritz', year: 2010, km: 95000, price: 110000,
            image: REAL, images: [REAL], fromCatalogue: false, isSellerListing: true }),
    ]);
    c.carType.set('Used');
    c.minYear.set(2018);

    expect(c.usedCount()).toBe(0);
    expect(c.filteredCars().length).toBe(0);
  });
});

describe('ListingsComponent — the year filter does not hide real inventory', () => {
  it('shows a 2010 advert by default', () => {
    /**
     * REPORTED: a 2010 Ritz visible on /used-cars and absent from Browse.
     *
     * minYear defaulted to 2018 and its slider floor was 2015, so every car
     * older than that was excluded from the page AND from the tab counts, with
     * no control able to bring it back. The catalogue looked empty rather than
     * filtered, which is the same failure as hiding a model with no
     * photograph: a rule with no visible cause.
     */
    const c = mountWith([
      car({ model: 'Ritz', year: 2010, km: 95000, price: 110000,
            image: REAL, images: [REAL], fromCatalogue: false, isSellerListing: true }),
    ]);
    c.carType.set('Used');

    expect(c.filteredCars().length).toBe(1);
    expect(c.usedCount()).toBe(1);
  });

  it('still filters when the reader sets a year', () => {
    // The control has to keep working; the fault was the default, not the
    // filter.
    const c = mountWith([
      car({ model: 'Ritz', year: 2010, km: 95000, price: 110000,
            image: REAL, images: [REAL], fromCatalogue: false, isSellerListing: true }),
      car({ model: 'Swift', year: 2020, km: 42000, price: 550000,
            image: REAL, images: [REAL], fromCatalogue: false, isSellerListing: true }),
    ]);
    c.carType.set('Used');
    expect(c.usedCount()).toBe(2);

    c.minYear.set(2018);

    expect(c.usedCount()).toBe(1);
    expect(c.filteredCars().length).toBe(1);
  });

  it('offers a slider floor that reaches the oldest car there is', () => {
    // A fixed floor of 2015 could not be dragged down to a 2010 car. The
    // control now spans what the catalogue actually holds.
    const c = mountWith([
      car({ model: 'Ritz', year: 2010, km: 95000, price: 110000,
            image: REAL, images: [REAL], fromCatalogue: false, isSellerListing: true }),
      car({ model: 'Baleno', image: REAL, images: [REAL] }),
    ]);

    expect(c.oldestYear()).toBe(2010);
  });
});

describe('ListingsComponent — switching tabs leaves the variants view', () => {
  it('clears the selected model', () => {
    // Reported from the Baleno Variants page: the New/Used/All bar was still
    // there, offering "Used Cars 0". Switching tabs left the drill-down alive
    // behind them, so returning to New reopened a model the reader had
    // navigated away from.
    const c = mountWith([car({ model: 'Baleno', image: REAL, images: [REAL] })]);
    c.selectedModel.set('Maruti Suzuki||Baleno');

    c.setCarType('Used');

    expect(c.selectedModel()).toBeNull();
  });
});
