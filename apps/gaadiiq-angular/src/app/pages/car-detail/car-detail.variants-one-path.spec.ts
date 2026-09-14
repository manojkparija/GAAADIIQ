/**
 * Every new car's Variants tab is the same tab.
 *
 * WHAT WAS REPORTED
 *
 * The Maruti Suzuki Swift's Variants list, circled: "not clickable". Beside
 * it, "compare it with Victoris — Victoris implementation is perfect".
 *
 * Both pages are this one component. The difference was the data:
 *
 *   Victoris  19 rows in car_variants  ->  .variant-row--detailed, clickable,
 *                                          each trim selectable and priceable
 *   Swift     0 rows                   ->  a SECOND tab, rendered from a
 *                                          hardcoded map in the component's
 *                                          own source, with no click handler
 *
 * The hardcoded rows could not be made clickable. They are grouped summaries —
 * "VXi, 7.49-8.09L, count: 2" — with no ids, so there is nothing to select and
 * nothing to price. They also carried a "View 2 Variants" badge styled like a
 * button that expanded nothing, which is what invited the click that did not
 * work.
 *
 * WHAT THESE PIN
 *
 * One rendering path. A car with trims gets the interactive list; a car
 * without gets the same "haven't been added yet" sentence the Specs and
 * Features tabs already use. No model gets a different kind of Variants tab
 * from any other, which is the whole of the report.
 *
 * The tab itself no longer appears on some new cars and not others, for the
 * same reason.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { CarDetailComponent } from './car-detail.component';

function trim(over: Partial<any> = {}): any {
  return {
    id: `v-${Math.random()}`, car_id: 'c1', name: 'VXi',
    ex_showroom_price: 749000, fuel_type: 'Petrol', transmission: 'Manual',
    engine_cc: 1197, seating_capacity: 5, mileage: '24.8 km/l',
    features: [], status: 'published', source: 'manual', sort_order: 0,
    ...over,
  };
}

let host: HTMLElement | null = null;

/**
 * `model` matters: 'Swift' is one of the six NEW_CAR_META carried, so it is
 * the case that used to take the second path. 'Victoris' is not in that map
 * at all.
 */
function render(model: string, variants: any[], isNew = true) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CarDetailComponent, RouterTestingModule],
    // RouterTestingModule supplies a real ActivatedRoute. A hand-rolled stub
    // was tried and broke on a paramMap the component reads during init —
    // "Cannot read properties of undefined (reading 'get')" — which is a
    // failing harness, not a failing page.
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(CarDetailComponent);
  const c = fixture.componentInstance as any;

  c.car = {
    id: 'c1', make: 'Maruti Suzuki', model, year: 2026,
    price: 649000, km: isNew ? 0 : 42000, fuel: 'Petrol', transmission: 'Manual',
    image: '', images: [], rating: 0, reviews: 0, verified: true,
    bodyType: 'Hatchback', fromCatalogue: true,
  };
  c.carLoaded = true;
  c.variants.set(variants);
  c.activeTab.set('variants');

  host = fixture.nativeElement as HTMLElement;
  document.body.appendChild(host);
  fixture.detectChanges();
  return { c, el: host };
}

describe('CarDetailComponent — one Variants tab for every car', () => {
  afterEach(() => { host?.remove(); host = null; });

  it('renders the interactive list when the car has trims', () => {
    const { el } = render('Victoris', [trim({ name: 'VXi' }), trim({ name: 'ZXi' })]);

    const rows = el.querySelectorAll('.variant-row--detailed');
    expect(rows.length).toBe(2);
  });

  it('says so plainly when the car has none — even a model the map covered', () => {
    // THE REPORTED CASE. The Swift is in NEW_CAR_META, so before this it got a
    // hardcoded price list instead. A frozen list hid the fact that nobody had
    // entered the trims.
    const { el } = render('Swift', []);

    expect(el.textContent).toContain("Variant details for this Maruti Suzuki Swift haven't been added yet");
  });

  it('never renders a second, non-interactive kind of variant row', () => {
    // THE ONE THAT MATTERS MOST. A .variant-row that is not
    // .variant-row--detailed is the old path: no click handler, nothing
    // selectable. Its return is the regression this guards.
    const { el } = render('Swift', []);

    const plain = Array.from(el.querySelectorAll('.variant-row'))
      .filter(r => !r.classList.contains('variant-row--detailed'));
    expect(plain.length).toBe(0);
  });

  it('offers no "View N Variants" badge anywhere', () => {
    // The thing that looked like a button and did nothing.
    const { el } = render('Swift', []);

    expect(el.querySelectorAll('.variant-count-badge').length).toBe(0);
    expect(el.textContent).not.toContain('View 2 Variants');
  });

  it('shows the Variants tab for a new car whether or not it has trims', () => {
    // A tab present on some models and absent on others is the same divergence
    // in a different place. Specs and Features are always there; so is this.
    const withTrims = render('Victoris', [trim()]).el.textContent;
    host?.remove();
    const without = render('Swift', []).el.textContent;

    expect(withTrims).toContain('Variants');
    expect(without).toContain('Variants');
  });

  it('still hides it on a used advert', () => {
    // One car at one price. A trim ladder says nothing about it, and this is
    // pre-existing behaviour that the change must not have widened.
    const { el } = render('Swift', [], false);

    const tabs = Array.from(el.querySelectorAll('.tab-nav button')).map(b => b.textContent?.trim());
    expect(tabs).not.toContain('Variants');
  });
});
