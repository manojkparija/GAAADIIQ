/**
 * The New Cars budget slider reaches ₹2 Cr, as the Browse page's does.
 *
 * Reported with both sliders side by side: Browse offered up to ₹2 Cr, New
 * Cars stopped at ₹1 Cr. The same site gave two different maximums for the
 * same catalogue, and a car above ₹1 Cr was unreachable from this page — with
 * no way for the reader to tell a filtered-out car from one that is not sold.
 *
 * The ceiling doubles as the "no upper bound asked for" value: at the top of
 * the slider the budget filter counts as unset. So it also decides the chip
 * count, the label, the reset, and whether maxPrice appears in the URL — which
 * is why these assert all of them rather than the slider alone.
 *
 * Deliberately NOT changed with it: formatLakh and formatBudgetLabel divide by
 * 10000000 to render crores. That literal means "one crore" there, not "the
 * ceiling", and moving the two together would have printed ₹2 Cr as "₹1 Cr".
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

const TWO_CRORE = 20000000;
const PHOTO = 'https://cdn.gaadiiq.test/x/front.webp';

function car(over: Partial<any> = {}): any {
  return {
    id: 'x', make: 'Rolls-Royce', model: 'Ghost', year: 2026,
    price: 15000000, km: 0, fuel: 'Petrol', transmission: 'Automatic',
    badge: '', badgeType: '', image: PHOTO, images: [PHOTO],
    rating: 0, reviews: 0, verified: true, bodyType: 'Sedan',
    isSellerListing: false, fromCatalogue: true, variantCount: 1,
    ...over,
  };
}

function mount(cars: any[] = []) {
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

describe('NewCarsComponent — the budget ceiling', () => {
  it('starts at ₹2 Cr', () => {
    expect(mount().maxBudget()).toBe(TWO_CRORE);
  });

  it('exposes the same ceiling to the slider', () => {
    // The template binds [max] to this. A slider capped lower than the signal
    // would snap the value down the moment anyone touched it.
    expect(mount().maxBudgetCeiling).toBe(TWO_CRORE);
  });

  it('shows a ₹1.5 Cr car, which the old ceiling excluded', () => {
    const c = mount([car({ price: 15000000 })]);

    expect(c.newCarModels().length)
      .withContext('above the old ₹1 Cr ceiling and so unreachable before')
      .toBe(1);
  });

  it('counts no budget filter while it sits at the ceiling', () => {
    const c = mount();

    expect(c.activeFiltersCount()).toBe(0);
  });

  it('counts one once the reader lowers it', () => {
    const c = mount();
    c.maxBudget.set(5000000);

    expect(c.activeFiltersCount()).toBe(1);
  });

  it('returns to ₹2 Cr when the filters are cleared', () => {
    const c = mount();
    c.maxBudget.set(5000000);
    c.clearAllFilters();

    expect(c.maxBudget()).toBe(TWO_CRORE);
  });

  it('labels the ceiling "₹2 Cr"', () => {
    // The end of the slider used to be the string "₹1 Cr" typed into the
    // template, so it would have stayed wrong under a ₹2 Cr slider.
    expect(mount().formatBudgetLabel(TWO_CRORE)).toBe('₹2 Cr');
  });

  it('still renders a ₹1 Cr price as "₹1 Cr"', () => {
    // The formatters divide by 10000000 to reach crores. That literal is the
    // unit, not the ceiling; moving them together would print ₹2 Cr here.
    expect(mount().formatBudgetLabel(10000000)).toBe('₹1 Cr');
    expect(mount().formatLakh(12500000)).toBe('₹1.3 Cr');
  });
});
