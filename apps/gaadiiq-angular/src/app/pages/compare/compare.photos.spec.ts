/**
 * What compare puts in front of the reader without being asked.
 *
 * WHAT THIS FILE USED TO SAY, AND WHY IT CHANGED
 *
 * It was written for a report of three e Vitara cards reading "No Image
 * Available", and it drew the rule that compare offers only cars the grids
 * still show — photograph-less catalogue rows hidden everywhere, picker
 * included.
 *
 * That went too wide. A later report, with the picker open on "maruti" and four
 * results showing: "All the models are not coming in the dropdown." A
 * suggestion row draws no image at all, only
 * `{{ c.year }} {{ c.make }} {{ c.model }}` and a price, so the photograph rule
 * was withholding most of the catalogue from a search to spare the reader a
 * picture that is never drawn. The reach of the picker now lives in
 * compare.search-reach.spec.ts, which owns that half.
 *
 * WHAT SURVIVES, AND IT IS THE PART THE ORIGINAL REPORT WAS ABOUT
 *
 * Nobody asked for an e Vitara. It was offered. The unprompted surfaces —
 * popular picks, and which of several matching rows a saved key resolves to —
 * are choices the page makes on the reader's behalf, and there a photograph is
 * still the right tiebreak, because a blank card is all the reader gets back.
 * A search is the opposite: they named the thing, and a result they cannot find
 * is worse than one that renders a placeholder.
 *
 * Adverts stay, as before. A listing is a real car someone is trying to sell,
 * and hiding it for want of a photograph removes them from the marketplace. The
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
  it('prefers a photographed row when a saved key matches several', () => {
    // The page is choosing here, not the reader: one key, two rows that both
    // answer to it. Same make, model, year and odometer, so the photograph is
    // the only thing left to choose on — and it decides what the restored card
    // looks like.
    const c = mount(
      [
        car({ id: 'blank', model: 'S-Presso', image: PLACEHOLDER, images: [PLACEHOLDER] }),
        car({ id: 'shot', model: 'S-Presso' }),
      ],
      { keys: 'Maruti Suzuki||S-Presso' },
    );

    expect(c.activeCars().map((x: any) => x.id)).toEqual(['shot']);
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

  it('still opens a saved key when no matching row has a photograph', () => {
    // The photograph is a tiebreak, not a veto. This used to resolve to nothing
    // and the reader's saved comparison came back empty, which is a worse answer
    // than a card with a placeholder on it: they saved this deliberately, and
    // every spec row below the image still carries its real numbers.
    const c = mount(
      [car({ model: 'e Vitara', image: PLACEHOLDER, images: [PLACEHOLDER] })],
      { keys: 'Maruti Suzuki||e Vitara' },
    );

    expect(c.activeCars().map((x: any) => x.model)).toEqual(['e Vitara']);
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

  it('finds the photograph-less model the picks deliberately omit', () => {
    // The two halves of this file in one assertion, so neither can be tightened
    // back onto the other by accident: the e Vitara is not volunteered, and it
    // is found the moment it is asked for.
    const c = mount([
      car({ model: 'e Vitara', image: PLACEHOLDER, images: [PLACEHOLDER] }),
      car({ model: 'S-Presso' }),
    ]);

    expect(c.popularPicks().map((x: any) => x.model)).not.toContain('e Vitara');

    c.searchA.set('vitara');
    expect(c.filtered(0).map((x: any) => x.model)).toEqual(['e Vitara']);
  });
});
