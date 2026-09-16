/**
 * Links to another car point at a route that exists.
 *
 * REPORTED, with a screenshot of the "Compare Maruti Suzuki Baleno with
 * Similar Cars" table: clicking "Maruti Suzuki S-Presso ›" landed on the home
 * page.
 *
 * WHY IT FAILED SILENTLY
 *
 * The route is `cars/:id` (app.routes.ts) and these links were built as
 * `['/car', s.id]` — singular. Angular matches no route for that, falls
 * through to `{ path: '**', redirectTo: '' }`, and renders Home. No error in
 * the console, no 404 page, nothing in any log: the reader simply ends up
 * somewhere else, and the only symptom is a person saying "it took me home".
 *
 * Three links were wrong — the similar-cars name and image here, and the AI
 * Advisor's "See the full model page →", which meant the entire advisor
 * feature recommended a car and then led nowhere.
 *
 * These assert the rendered href rather than the routerLink input, because
 * the input is what was already wrong: `['/car', id]` is a perfectly valid
 * array, and only resolving it against the router shows it goes nowhere.
 */
import { signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { CarDetailComponent } from './car-detail.component';
import { CarsDataService } from '../../services/cars-data.service';

const PHOTO = 'https://cdn.gaadiiq.test/x.webp';

function car(over: Partial<any> = {}): any {
  return {
    id: 'baleno-id', make: 'Maruti Suzuki', model: 'Baleno', year: 2026,
    price: 610000, km: 0, fuel: 'Petrol', transmission: 'Manual',
    badge: '', badgeType: '', image: PHOTO, images: [PHOTO],
    rating: 0, reviews: 0, verified: true, bodyType: 'Hatchback',
    isSellerListing: false, fromCatalogue: true,
    variantCount: 10, variantPriceMin: 610000, variantPriceMax: 1009000,
    ...over,
  };
}

/** The S-Presso from the report — same body type, so it lands in similarCars. */
const SPRESSO = car({
  id: 's-presso-id', model: 'S-Presso',
  price: 430000, variantPriceMin: 426500, variantPriceMax: 640000,
});

function mount(): ComponentFixture<CarDetailComponent> {
  const cars = [car(), SPRESSO];
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CarDetailComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap({ id: 'baleno-id' }),
            // ngOnInit reads this for the ?tab= deep link.
            queryParamMap: convertToParamMap({}),
          },
          queryParams: { subscribe: () => {} },
        },
      },
      {
        provide: CarsDataService,
        useValue: {
          cars: signal(cars),
          loading: signal(false),
          getById: (id: string) => cars.find(c => c.id === id),
          getAll: () => cars,
          reload: async () => {},
          fullCar: async () => null,
          variantsFor: async () => [],
        },
      },
    ],
  });
  const f = TestBed.createComponent(CarDetailComponent);
  f.detectChanges();
  return f;
}

describe('CarDetailComponent — the similar-cars table links somewhere real', () => {
  it('sends the reader to that car, not to the home page', () => {
    const f = mount();
    const links: HTMLAnchorElement[] =
      Array.from(f.nativeElement.querySelectorAll('.similar-link'));

    expect(links.length).withContext('no similar cars rendered to test').toBeGreaterThan(0);

    for (const a of links) {
      // The reported bug: '/car/<id>' matches no route and redirects to ''.
      expect(a.getAttribute('href'))
        .withContext(`"${a.textContent?.trim()}" points at a route that does not exist`)
        .toMatch(/^\/cars\//);
    }
  });

  it('links the row image to the same place as the name', () => {
    // Both cells were wrong, and a reader is as likely to click the picture.
    const f = mount();
    const name: HTMLAnchorElement = f.nativeElement.querySelector('.similar-link');
    const image: HTMLAnchorElement | null =
      f.nativeElement.querySelector('.similar-img-cell a');

    expect(image).withContext('the image cell is not a link at all').toBeTruthy();
    expect(image!.getAttribute('href')).toBe(name.getAttribute('href'));
  });
});
