/**
 * Compare can find every car it claims to have.
 *
 * REPORTED with the picker open on "maruti", four results showing: "All the
 * models are not coming in the dropdown."
 *
 * TWO CAUSES, AND THE FIRST IS THE ONE THAT HURT
 *
 * `filtered()` ran the catalogue through isShowable, which drops a catalogue
 * row that has no photograph. That rule earns its place on the New Cars and
 * Browse grids, where a card without a picture is a blank tile — the old
 * comment here cited exactly those two screens.
 *
 * It does not earn it here, and the markup is the argument:
 *
 *     <div class="drop-item" ...>
 *       <span>{{ c.year }} {{ c.make }} {{ c.model }}</span>
 *       <span class="drop-price">{{ formatPrice(startsAt(c)) }}</span>
 *
 * A suggestion has no image. So the photograph rule was withholding most of
 * the catalogue to protect the reader from a picture that is never drawn, on
 * a page whose own subtitle promises "Search any car from our database". The
 * table they land on falls back to assets/cars/placeholder.svg, so an
 * unphotographed model compares perfectly well; it just could not be found.
 *
 * The second cause was the cap: eight results, with nothing saying so. That is
 * the same fault an order of magnitude smaller — the reader cannot tell "that
 * is all there is" from "that is all we are showing you". Asked for, in those
 * words: "if user type Maruti then all the variants should be in the drop
 * down". So a search returns everything it matches, and only the unprompted
 * list is capped, where the cars shown are arbitrary anyway.
 *
 * The dropdown had `overflow:hidden` and no max-height, which was survivable
 * at eight rows and is not at thirty. It scrolls now.
 *
 * THE COUNT WAS A LITERAL
 *
 * "our 54-car database" was typed into the template. Nobody maintained it, and
 * it was already wrong twice over: wrong whenever a car is added, and wrong
 * about what it counted, since 54 was the photographed subset rather than the
 * catalogue. It is counted now.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

import { CompareComponent } from './compare.component';
import { CarsDataService } from '../../services/cars-data.service';

const PHOTO = 'https://res.cloudinary.com/demo/image/upload/swift.webp';

function car(over: Partial<any> = {}): any {
  return {
    id: 'c1', make: 'Maruti Suzuki', model: 'Swift', year: 2026,
    price: 649000, km: 0, fuel: 'Petrol', transmission: 'Manual',
    badge: '', badgeType: '', image: PHOTO, images: [PHOTO],
    rating: 0, reviews: 0, verified: true, bodyType: 'Hatchback',
    isSellerListing: false, fromCatalogue: true, variantCount: 1,
    ...over,
  };
}

/** A catalogue row with no photograph — the kind that was being hidden. */
function unphotographed(over: Partial<any> = {}): any {
  return car({ image: null, images: [], ...over });
}

function mount(cars: any[]) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CompareComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(convertToParamMap({})),
          queryParams: of({}),
          snapshot: {
            paramMap: convertToParamMap({}),
            queryParamMap: convertToParamMap({}),
          },
        },
      },
      {
        provide: CarsDataService,
        useValue: {
          cars: signal(cars), loading: signal(false),
          getById: () => cars[0], getAll: () => cars,
          reload: async () => {}, variantsFor: async () => [],
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(CompareComponent);
  return fixture.componentInstance as any;
}

describe('CompareComponent — the picker reaches the whole catalogue', () => {
  it('offers a model that has no photograph', () => {
    // THE REPORTED BUG. The suggestion row shows no image, so there was never
    // anything for the photograph rule to protect.
    const c = mount([
      car({ id: 'swift', model: 'Swift' }),
      unphotographed({ id: 'baleno', model: 'Baleno' }),
    ]);
    c.searchA.set('maruti');

    const models = c.filtered(0).map((x: any) => x.model);

    expect(models).toContain('Baleno');
  });

  it('offers every match, not the photographed ones', () => {
    const c = mount([
      car({ id: 'a', model: 'Swift' }),
      unphotographed({ id: 'b', model: 'Baleno' }),
      unphotographed({ id: 'c', model: 'Brezza' }),
      unphotographed({ id: 'd', model: 'Alto K10' }),
    ]);
    c.searchA.set('maruti');

    expect(c.filtered(0).length).toBe(4);
  });

  it('returns every match, however many there are', () => {
    // "if user type Maruti then all the variants should be in the drop down".
    // Thirty, well past the old cap of eight and the unprompted cap of twenty.
    const many = Array.from({ length: 30 }, (_, i) =>
      unphotographed({ id: `m${i}`, model: `Model${i}` }),
    );
    const c = mount(many);
    c.searchA.set('maruti');

    expect(c.filtered(0).length).toBe(30);
  });

  it('still caps the list shown before anything is typed', () => {
    // Different question. With no query the cars offered are arbitrary, so the
    // whole catalogue would be noise rather than an answer.
    const many = Array.from({ length: 30 }, (_, i) =>
      unphotographed({ id: `m${i}`, model: `Model${i}` }),
    );
    const c = mount(many);

    expect(c.filtered(0).length).toBe(20);
  });

  it('matches on model as well as make', () => {
    // A reader who types "baleno" is searching too, and must not be capped
    // into a different answer from one who types "maruti".
    const c = mount([
      car({ id: 'a', model: 'Swift' }),
      unphotographed({ id: 'b', model: 'Baleno' }),
    ]);
    c.searchA.set('baleno');

    expect(c.filtered(0).map((x: any) => x.model)).toEqual(['Baleno']);
  });

  it('counts the database rather than quoting a number', () => {
    // "our 54-car database" was a literal, and 54 was the photographed subset.
    const c = mount([car({ id: 'a' }), unphotographed({ id: 'b' }), car({ id: 'c' })]);

    expect(c.searchableCount()).toBe(3);
  });

  it('restores a saved comparison whose car has no photograph', () => {
    // The other half of the change: selectable but not restorable would be a
    // worse state than either rule alone.
    const c = mount([unphotographed({ id: 'b', model: 'Baleno' })]);

    const found = c.carsData
      .cars()
      .filter((x: any) => x.make === 'Maruti Suzuki' && x.model === 'Baleno');

    expect(found.length).toBe(1);
    expect(c.filtered(0).map((x: any) => x.model)).toContain('Baleno');
  });
});
