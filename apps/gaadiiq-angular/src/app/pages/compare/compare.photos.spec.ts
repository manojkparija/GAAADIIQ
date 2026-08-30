/**
 * Compare offers only cars the rest of the site still shows.
 *
 * Reported from /compare: three e Vitara cards reading "No Image Available",
 * for a model whose images had been removed from the database. The grids stop
 * showing such a model; the compare picker went on offering it, so the site
 * contradicted itself depending on which page you were standing on.
 *
 * Comparing two blank cards is also not a comparison — the photograph is most
 * of what a compare card carries.
 *
 * Adverts stay. A listing is a real car someone is trying to sell, and hiding
 * it for want of a photograph removes them from the marketplace. The
 * distinction is `fromCatalogue`, not `isSellerListing`: the latter is
 * `listing_type === 'used'`, so a dealer's advert for a brand-new car reads
 * false there exactly as a catalogue row does.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { CompareComponent } from './compare.component';
import { CarsDataService, PLACEHOLDER } from '../../services/cars-data.service';

const PHOTO = 'https://cdn.gaadiiq.test/s-presso/front.webp';

let fixture: any;

function car(over: Partial<any> = {}): any {
  return {
    id: `id-${over['model'] ?? 'x'}`, make: 'Maruti Suzuki', model: 'S-Presso',
    year: 2026, price: 530000, km: 0,
    fuel: 'Petrol', transmission: 'Manual',
    badge: '', badgeType: '', image: PHOTO, images: [PHOTO],
    rating: 0, reviews: 0, verified: true, bodyType: 'Hatchback',
    isSellerListing: false, fromCatalogue: true, variantCount: 14,
    ...over,
  };
}

function mount(cars: any[], params: Record<string, string> = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CompareComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { queryParams: of(params), snapshot: { queryParams: params } } },
      { provide: CarsDataService, useValue: { cars: signal(cars), loading: signal(false), failedSources: signal([]) } },
    ],
  });
  fixture = TestBed.createComponent(CompareComponent);
  const c = fixture.componentInstance as any;
  // The saved/deep-linked keys are resolved in ngOnInit, not the constructor.
  // Without this the two key tests pass without ever exercising the lookup —
  // one of them was green for exactly that reason before this line existed.
  c.ngOnInit();
  return c;
}

describe('CompareComponent — which cars can be compared', () => {
  it('does not offer a catalogue car with no photograph', () => {
    const c = mount([
      car({ model: 'e Vitara', image: PLACEHOLDER, images: [PLACEHOLDER] }),
      car({ model: 'S-Presso' }),
    ]);

    expect(c.filtered(0).map((x: any) => x.model)).toEqual(['S-Presso']);
  });

  it('still offers an advert with no photograph', () => {
    const c = mount([
      car({ model: 'Alto', fromCatalogue: false, isSellerListing: true,
            km: 42000, year: 2019, image: PLACEHOLDER, images: [PLACEHOLDER] }),
    ]);

    expect(c.filtered(0).length).toBe(1);
  });

  it("still offers a dealer's advert for a brand-new car", () => {
    // fromCatalogue false, isSellerListing false — the combination that a
    // check on isSellerListing alone would have hidden.
    const c = mount([
      car({ model: 'Baleno', fromCatalogue: false, isSellerListing: false,
            image: PLACEHOLDER, images: [PLACEHOLDER] }),
    ]);

    expect(c.filtered(0).length).toBe(1);
  });

  it('keeps a photograph-less car out of the popular picks', () => {
    const c = mount([
      car({ make: 'Tata', model: 'Nexon', image: PLACEHOLDER, images: [PLACEHOLDER] }),
      car({ model: 'S-Presso' }),
    ]);

    expect(c.popularPicks().map((x: any) => x.model)).toEqual(['S-Presso']);
  });

  it('ignores a saved compare key whose model lost its photographs', () => {
    // A key stored before the images were deleted would otherwise reopen a
    // blank card, and compare would keep showing what the grids stopped.
    const c = mount(
      [car({ model: 'e Vitara', image: PLACEHOLDER, images: [PLACEHOLDER] })],
      { keys: 'Maruti Suzuki||e Vitara' },
    );

    expect(c.activeCars()).toEqual([]);
  });

  it('opens a saved key that still has photographs', () => {
    const c = mount([car({ model: 'S-Presso' })], { keys: 'Maruti Suzuki||S-Presso' });

    expect(c.activeCars().length).toBe(1);
  });

  it('leaves the table corner blank and unshaded', () => {
    // The corner cell above the row labels. Emptying its text left the shaded
    // background behind, which read as a stray grey column — worst on a phone,
    // where it is 120px wide and as tall as the car images beside it.
    //
    // The element itself has to stay: without it every car column shifts one
    // place left and the header stops lining up with the rows underneath.
    const c = mount([car({ model: 'S-Presso' }), car({ model: 'Alto', id: 'id-Alto' })]);
    c.selected.set([c.carsData.cars()[0], c.carsData.cars()[1], null]);
    fixture.detectChanges();

    const corner = fixture.nativeElement.querySelector('.comp-label-col');
    expect(corner).withContext('the grid placeholder must remain').toBeTruthy();
    expect(corner.textContent.trim()).toBe('');

    const bg = getComputedStyle(corner).backgroundColor;
    expect(['rgba(0, 0, 0, 0)', 'transparent'])
      .withContext(`corner cell painted ${bg}`)
      .toContain(bg);
  });

  it('searches within what it offers', () => {
    const c = mount([
      car({ model: 'e Vitara', image: PLACEHOLDER, images: [PLACEHOLDER] }),
      car({ model: 'S-Presso' }),
    ]);
    c.searchA.set('vitara');

    expect(c.filtered(0)).toEqual([]);
  });
});
