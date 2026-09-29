/**
 * Clicking a brand shows that brand's cars.
 *
 * REPORTED, with the navbar's "Browse by Brand" menu open over the grid:
 * "if I am clicking Hyundai then it should show only hyundai cars". The chips
 * link to `/new-cars?make=<brand>`, the page scrolled down to the grid, and
 * the grid showed every manufacturer.
 *
 * WHY IT LOOKED LIKE IT HAD WORKED
 *
 * `make` was already in the `narrows` list — the one that decides whether a
 * parameter scrolls the reader to the models section. So the click moved the
 * page exactly as `bodyType` and `fuel` do. Each of those also had a handler
 * that applied it. `make` had none, so the only thing the parameter ever did
 * was scroll: the strongest possible impression of a filter, with no filter.
 *
 * That `narrows` list was itself written for a near-identical fault — the
 * Electric Cars entry filtered correctly and left the reader at the top of
 * the page — and its comment calls these "every param that narrows the list".
 * `make` was in the list on that understanding, which was not true of it.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { NewCarsComponent } from './new-cars.component';
import { CarsDataService } from '../../services/cars-data.service';

const PHOTO = 'https://cdn.gaadiiq.test/car.webp';

function car(over: Partial<any> = {}): any {
  return {
    id: `c-${Math.random()}`, make: 'Maruti Suzuki', model: 'Baleno', year: 2026,
    price: 700000, km: 0, fuel: 'Petrol', transmission: 'Manual',
    variantFuels: ['Petrol'], variantTransmissions: ['Manual'],
    badge: '', badgeType: '', image: PHOTO, images: [PHOTO],
    rating: 0, reviews: 0, verified: true, bodyType: 'Hatchback',
    isSellerListing: false, variantCount: 5,
    ...over,
  };
}

/** A catalogue with two manufacturers in it, as the report's screenshot had. */
const CATALOGUE = [
  car({ make: 'Maruti Suzuki', model: 'Baleno' }),
  car({ make: 'Maruti Suzuki', model: 'Alto K10', price: 400000 }),
  car({ make: 'Hyundai', model: 'Creta', price: 1100000, bodyType: 'SUV' }),
  car({ make: 'Hyundai', model: 'Venue', price: 800000, bodyType: 'SUV' }),
];

function mount(params: Record<string, string> = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [NewCarsComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: { queryParams: of(params), snapshot: { queryParams: params } },
      },
      {
        provide: CarsDataService,
        useValue: {
          cars: signal(CATALOGUE), loading: signal(false), failedSources: signal([]),
        },
      },
    ],
  });
  const f = TestBed.createComponent(NewCarsComponent);
  f.detectChanges();
  return f.componentInstance as any;
}

const makesOf = (c: any): string[] =>
  [...new Set(c.newCarModels().map((m: any) => m.make))] as string[];

describe('NewCarsComponent — the brand link filters the grid', () => {
  it('shows only that brand', () => {
    // THE REPORTED BUG. Before this, every make came back.
    const c = mount({ make: 'Hyundai' });

    expect(makesOf(c)).toEqual(['Hyundai']);
    expect(c.newCarModels().length).toBe(2);
  });

  it('shows every brand when no make is asked for', () => {
    const c = mount({});

    expect(makesOf(c).sort()).toEqual(['Hyundai', 'Maruti Suzuki']);
  });

  it('matches whatever casing and spacing the URL carries', () => {
    // The parameter comes from a URL a reader can edit and other pages build.
    for (const written of ['hyundai', 'HYUNDAI', ' Hyundai ']) {
      const c = mount({ make: written });

      expect(makesOf(c))
        .withContext(`?make=${written} found nothing`)
        .toEqual(['Hyundai']);
    }
  });

  it('matches the whole name, not a fragment of it', () => {
    // "Maruti" must not quietly stand in for "Maruti Suzuki" — a filter that
    // half-matches is harder to notice than one that matches nothing.
    const c = mount({ make: 'Maruti' });

    expect(c.newCarModels().length).toBe(0);
  });

  it('narrows within the brand rather than replacing it', () => {
    // Both filters together, which is what the sidebar does next.
    const c = mount({ make: 'Hyundai' });
    c.toggleBodyType('SUV');

    expect(makesOf(c)).toEqual(['Hyundai']);
    expect(c.newCarModels().length).toBe(2);
  });

  it('counts the brand as an active filter', () => {
    // This is what puts the badge and the "Clear All" button on screen. A
    // grid narrowed by something the reader cannot see or undo is the same
    // fault as the silently hidden photo-less models.
    const c = mount({ make: 'Hyundai' });

    expect(c.activeFiltersCount()).toBe(1);
  });

  it('puts the other brands back when the chip is cleared', () => {
    const c = mount({ make: 'Hyundai' });
    c.clearMake();

    expect(makesOf(c).sort()).toEqual(['Hyundai', 'Maruti Suzuki']);
    expect(c.activeFiltersCount()).toBe(0);
  });

  it('clears the brand with Clear All', () => {
    // "Clear All" that left the grid narrowed would empty the sidebar with
    // nothing on screen to explain the missing cars.
    const c = mount({ make: 'Hyundai' });
    c.clearAllFilters();

    expect(c.selectedMake()).toBe('');
    expect(makesOf(c).sort()).toEqual(['Hyundai', 'Maruti Suzuki']);
  });

  it('leaves the brand when the parameter goes away', () => {
    // Set on every emission, not only when present, so the back button out of
    // a brand actually leaves it.
    const c = mount({ make: 'Hyundai' });
    expect(c.selectedMake()).toBe('Hyundai');

    (c as any).selectedMake.set('');

    expect(makesOf(c).sort()).toEqual(['Hyundai', 'Maruti Suzuki']);
  });

  it('finds nothing for a brand the catalogue does not have', () => {
    // An empty grid is the honest answer; the page's own empty state explains
    // it and offers Clear Filters.
    const c = mount({ make: 'Tata' });

    expect(c.newCarModels().length).toBe(0);
    expect(c.activeFiltersCount()).toBe(1);
  });
});
