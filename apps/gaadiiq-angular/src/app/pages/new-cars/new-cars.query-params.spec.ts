/**
 * Arriving with a filter in the URL must land on the filtered list.
 *
 * Reported: the navbar's "Electric Cars" entry appeared to go to Explore New
 * Cars instead of to electric cars.
 *
 * The filter was in fact applied. `?fuel=Electric` set selectedFuels
 * correctly — but `fuel` was missing from the list of params that trigger
 * scrollToModels(), so the reader was left at the top of the page looking at
 * the "Explore New Cars" hero, several screens above the result they asked
 * for. A filter nobody can see is indistinguishable from one that never ran.
 *
 * These assert both halves, because either alone passes on the broken page:
 * a test that only checked selectedFuels would have been green throughout.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { NewCarsComponent } from './new-cars.component';

/** Mounts the page as if the browser had arrived at ?<params>. */
function mount(params: Record<string, string>): ComponentFixture<NewCarsComponent> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [NewCarsComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { queryParams: of(params), snapshot: { queryParams: params } } },
    ],
  });
  return TestBed.createComponent(NewCarsComponent);
}

describe('NewCarsComponent — arriving with a filter in the URL', () => {
  it('applies ?fuel=Electric', () => {
    const c = mount({ fuel: 'Electric' }).componentInstance as any;
    c.ngOnInit();
    expect(c.selectedFuels()).toEqual(['Electric']);
  });

  it('scrolls to the results for ?fuel, not just for the other filters', (done) => {
    const fixture = mount({ fuel: 'Electric' });
    const c = fixture.componentInstance as any;

    let scrolled = false;
    c.scrollToModels = () => { scrolled = true; };

    c.ngOnInit();

    // The scroll is deferred by setTimeout(…, 100) so the list has rendered.
    setTimeout(() => {
      expect(scrolled)
        .withContext('landed on the hero: the filter applied but nothing moved to it')
        .toBe(true);
      done();
    }, 150);
  });

  it('still scrolls for the params that already worked', (done) => {
    const checks: Record<string, string>[] = [
      { bodyType: 'SUV' }, { make: 'Tata' }, { minPrice: '500000' },
    ];
    let pending = checks.length;

    for (const params of checks) {
      const c = mount(params).componentInstance as any;
      let scrolled = false;
      c.scrollToModels = () => { scrolled = true; };
      c.ngOnInit();
      setTimeout(() => {
        expect(scrolled).withContext(`${JSON.stringify(params)} stopped scrolling`).toBe(true);
        if (--pending === 0) done();
      }, 150);
    }
  });

  it('does not scroll when no filter was asked for', (done) => {
    // A bare /new-cars visit must show the hero. Scrolling past it on every
    // visit would be a worse bug than the one being fixed.
    const c = mount({}).componentInstance as any;
    let scrolled = false;
    c.scrollToModels = () => { scrolled = true; };
    c.ngOnInit();
    setTimeout(() => {
      expect(scrolled).withContext('yanked the page down on a plain visit').toBe(false);
      done();
    }, 150);
  });

  it('does not scroll for params that only carry state', (done) => {
    // `keys` is the compare selection. It narrows nothing and must not move
    // the page.
    const c = mount({ keys: 'a,b' }).componentInstance as any;
    let scrolled = false;
    c.scrollToModels = () => { scrolled = true; };
    c.ngOnInit();
    setTimeout(() => {
      expect(scrolled).toBe(false);
      done();
    }, 150);
  });
});
