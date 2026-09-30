/**
 * Choosing a trim on a phone shows what it costs.
 *
 * REPORTED from the Android app, with a screenshot of the variants list:
 * "if user click one particular variant then the on-road price and EMI
 * calculation should be visible like web application", and then plainly:
 * "emi details are coming in mob app at the last".
 *
 * NOTHING WAS COMPUTED WRONGLY
 *
 * onRoadPrice() already reads selectedVariant(), and financeableMax() follows
 * it, so both panels answered for the chosen trim the whole time. They were
 * unreachable, not wrong.
 *
 * The page is a two-column grid with the panels beside the list. Under 1024px
 * that collapses to one column, which puts the whole of .detail-right —
 * on-road price, EMI calculator and the action buttons — after the entire tab
 * body. For a Creta that is seventeen trims of feature text. So a tap updated
 * numbers several screens below the fold, and on a phone the selection looked
 * like it did nothing.
 *
 * Scrolling rather than adding a second copy of the panels: another EMI
 * calculator is another thing to keep in step with the first, and these are
 * the numbers a buyer acts on.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

import { CarDetailComponent } from './car-detail.component';
import { CarsDataService } from '../../services/cars-data.service';

const PHOTO = 'https://cdn.gaadiiq.test/creta.webp';

function creta(over: Partial<any> = {}): any {
  return {
    id: 'creta-2026', make: 'Hyundai', model: 'Creta', year: 2026,
    price: 1100000, km: 0, fuel: 'Petrol', transmission: 'Manual',
    badge: '', badgeType: '', image: PHOTO, images: [PHOTO],
    rating: 0, reviews: 0, verified: true, bodyType: 'SUV',
    isSellerListing: false, fromCatalogue: true, variantCount: 17,
    ...over,
  };
}

/** Two real trims from the report's screenshot, a lakh apart. */
const TRIMS = [
  {
    id: 'v-mt-dsl-e', car_id: 'creta-2026', name: 'Creta MT DSL E',
    ex_showroom_price: 1261000, fuel_type: 'Diesel', transmission: 'Manual',
    status: 'published',
  },
  {
    id: 'v-ex-o', car_id: 'creta-2026', name: 'Creta EX(O)',
    ex_showroom_price: 1340000, fuel_type: 'Petrol', transmission: 'Manual',
    status: 'published',
  },
] as any[];

function mount() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CarDetailComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: {
          paramMap: of(convertToParamMap({ id: 'creta-2026' })),
          snapshot: {
            paramMap: convertToParamMap({ id: 'creta-2026' }),
            queryParamMap: convertToParamMap({}),
          },
          queryParams: { subscribe: () => {} },
        },
      },
      {
        provide: CarsDataService,
        useValue: {
          cars: signal([creta()]), loading: signal(false),
          getById: () => creta(), getAll: () => [creta()],
          reload: async () => {}, fullCar: async () => null,
          variantsFor: async () => TRIMS,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(CarDetailComponent);
  const c = fixture.componentInstance as any;

  // The car first, so the panels' *ngIf conditions hold and the @ViewChild
  // refs this scrolls to actually resolve.
  c.car = creta();
  fixture.detectChanges();

  // Then the trims, AFTER init: ngOnInit resolves the car afresh and clears
  // the selection with it, so anything set before this is discarded.
  c.car = creta();
  c.variants.set(TRIMS);
  fixture.detectChanges();
  return c;
}

/**
 * Pretend the viewport is a phone, or a desktop.
 *
 * window.innerWidth is global and Jasmine randomises spec order, so a width
 * left behind here becomes some unrelated suite's viewport. That is exactly
 * what happened on the first full run: green in isolation, one unrelated
 * failure in the suite. `restoreWidth` in afterEach puts it back.
 */
const REAL_WIDTH = window.innerWidth;

function widthIs(px: number): void {
  Object.defineProperty(window, 'innerWidth', {
    value: px, configurable: true, writable: true,
  });
}

function restoreWidth(): void {
  Object.defineProperty(window, 'innerWidth', {
    value: REAL_WIDTH, configurable: true, writable: true,
  });
}

describe('CarDetailComponent — a chosen trim prices itself', () => {
  let scrolled: jasmine.Spy;

  beforeEach(() => {
    // Every element, because which panel is on screen depends on the car.
    scrolled = spyOn(Element.prototype, 'scrollIntoView');
  });

  afterEach(() => restoreWidth());

  it('prices the trim the reader chose, not the model', () => {
    // The panels were always right — this pins that, so a later change to
    // the scrolling cannot quietly take the correctness with it.
    const c = mount();

    c.selectVariant(TRIMS[1]);

    expect(c.selectedVariant()?.id).toBe('v-ex-o');
    expect(c.onRoadPrice()?.base).toBe(1340000);
  });

  it('brings the price panel into view on a phone', async () => {
    // THE REPORTED BUG: on a narrow screen the panel is below the whole tab
    // body, so the tap appeared to do nothing.
    widthIs(390);
    const c = mount();

    c.selectVariant(TRIMS[0]);
    await new Promise(r => setTimeout(r));

    expect(scrolled).toHaveBeenCalled();
  });

  it('leaves the page alone on a desktop', () => {
    // There the panel sits beside the list and is already in view; moving
    // the page would be the surprise.
    widthIs(1440);
    const c = mount();

    c.selectVariant(TRIMS[0]);

    expect(scrolled).not.toHaveBeenCalled();
  });

  it('does not move the page when a trim is cleared', async () => {
    // Tapping the chosen trim again goes back to the model's price, and the
    // reader is back to browsing the ladder.
    widthIs(390);
    const c = mount();
    c.selectVariant(TRIMS[0]);
    await new Promise(r => setTimeout(r));
    scrolled.calls.reset();

    c.selectVariant(TRIMS[0]);
    await new Promise(r => setTimeout(r));

    expect(c.selectedVariantId()).toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('does nothing for a trim with no price', async () => {
    // selectVariant already refuses these — there is nothing to price, so
    // there is nothing to show.
    widthIs(390);
    const c = mount();

    c.selectVariant({ ...TRIMS[0], id: 'v-none', ex_showroom_price: null });
    await new Promise(r => setTimeout(r));

    expect(c.selectedVariantId()).toBeNull();
    expect(scrolled).not.toHaveBeenCalled();
  });

  it('moves again when a second trim is chosen', async () => {
    // Each tap shows that trim's numbers; the panel is what changed.
    widthIs(390);
    const c = mount();
    c.selectVariant(TRIMS[0]);
    await new Promise(r => setTimeout(r));
    scrolled.calls.reset();

    c.selectVariant(TRIMS[1]);
    await new Promise(r => setTimeout(r));

    expect(scrolled).toHaveBeenCalled();
    expect(c.onRoadPrice()?.base).toBe(1340000);
  });

  it('honours a request for less motion', async () => {
    widthIs(390);
    spyOn(window, 'matchMedia').and.returnValue({ matches: true } as any);
    const c = mount();

    c.selectVariant(TRIMS[0]);
    await new Promise(r => setTimeout(r));

    expect(scrolled).toHaveBeenCalledWith(
      jasmine.objectContaining({ behavior: 'auto' }),
    );
  });
});
