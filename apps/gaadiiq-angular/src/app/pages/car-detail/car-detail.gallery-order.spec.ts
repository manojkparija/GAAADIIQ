/**
 * The car page shows the gallery in the order the admin arranged.
 *
 * REPORTED: an admin reordered a Swift's photographs in Image Review, the
 * panel showed the new order immediately, and the car's page on the site kept
 * the old one. Reordering had worked the day before.
 *
 * THE CAUSE
 *
 * The page renders a car from the listing endpoint, then fetches the full
 * record and merges the better gallery in. That merge was:
 *
 *     images: urls.length > (this.car.images?.length ?? 0) ? urls : this.car.images
 *
 * A count test standing in for a freshness test. A reorder does not change the
 * count — the same seven photographs in a different order — so `7 > 7` was
 * false and the page kept the list copy, which is capped, sampled, and in
 * whatever order it arrived. It "worked yesterday" only while the list copy was
 * still SHORTER than the full gallery: the fresh one then won on length and
 * carried the new order with it by accident.
 *
 * The full record is the authority on both which photographs a car has and what
 * order they go in. The only thing worth guarding against is it arriving empty.
 */
import { TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';

import { CarDetailComponent } from './car-detail.component';
import { CarsDataService } from '../../services/cars-data.service';

const CAR_ID = 'car-swift';

/** The gallery as the LIST endpoint returned it — stale order, same count. */
const STALE = ['a.jpg', 'b.jpg', 'c.jpg'];
/** The same three photographs, in the order the admin just arranged. */
const ARRANGED = ['c.jpg', 'a.jpg', 'b.jpg'];

function build(fullCarImages: string[]) {
  TestBed.resetTestingModule();
  const car: any = {
    id: CAR_ID, make: 'Maruti Suzuki', model: 'Swift', year: 2026,
    price: 584000, fuel: 'Petrol', transmission: 'Manual', city: 'Kolkata',
    images: [...STALE], image: STALE[0], isSellerListing: false,
  };
  TestBed.configureTestingModule({
    imports: [CarDetailComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: CarsDataService,
        useValue: {
          cars: signal([car]),
          loading: signal(false),
          getById: () => car,
          getAll: () => [car],
          variantsFor: async () => [],
          fullCar: async () => ({ images: fullCarImages, spinImages: [], specs: [], features: [] }),
        },
      },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: convertToParamMap({ id: CAR_ID }),
            queryParamMap: convertToParamMap({}),
          },
        },
      },
    ],
  });
  const c = TestBed.createComponent(CarDetailComponent).componentInstance as any;
  c.ngOnInit();
  return c;
}

describe('CarDetailComponent — the gallery order the buyer gets', () => {
  it('takes the arranged order even though the count is unchanged', fakeAsync(() => {
    // THE REPORTED BUG. Three photographs before, three after.
    const c = build(ARRANGED);

    tick();

    expect(c.galleryImages()).toEqual(ARRANGED);
    discardPeriodicTasks();   // the page's 360 hint interval
  }));

  it('leads with the photograph the admin made the cover', fakeAsync(() => {
    // Position 0 is the cover, and the page opens on it.
    const c = build(ARRANGED);

    tick();

    expect(c.galleryImages()[0]).toBe('c.jpg');
    expect(c.activeImg()).toBe(0);
    discardPeriodicTasks();
  }));

  it('still takes a longer gallery', fakeAsync(() => {
    // The behaviour the count test was written for: the list page caps how
    // many photographs it carries, so the full record usually has more.
    const c = build([...ARRANGED, 'd.jpg']);

    tick();

    expect(c.galleryImages().length).toBe(4);
    discardPeriodicTasks();
  }));

  it('keeps what it has when the full record has no photographs', fakeAsync(() => {
    // THE ONE THAT MATTERS MOST. An empty answer must not blank a gallery the
    // page already has — that would turn a fetch failure into a car with no
    // pictures, which is the fault this whole area keeps producing.
    const c = build([]);

    tick();

    expect(c.galleryImages()).toEqual(STALE);
    discardPeriodicTasks();
  }));
});
