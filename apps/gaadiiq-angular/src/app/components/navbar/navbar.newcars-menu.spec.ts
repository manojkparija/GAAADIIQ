/**
 * The New Cars menu.
 *
 * The risk with a menu is not that it fails to render — it is that an entry
 * points somewhere that does not exist, or somewhere with nothing behind it.
 * A dead menu item costs a click and some trust before it teaches the reader
 * anything, so the assertions below are about destinations rather than looks:
 *
 *  - every routerLink in the menu resolves against the real route table;
 *  - the brand list comes from the catalogue, so it cannot offer a make with
 *    no cars — and vanishes entirely when the catalogue is empty.
 *
 * The reference menu this follows also lists Offers & Discounts, Find Dealers,
 * EV Charging Stations and Fuel Prices. None of that data exists here, so none
 * of it is in the menu; that omission is the point, not an oversight.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { NavbarComponent } from './navbar.component';
import { CarsDataService } from '../../services/cars-data.service';
import { AuthService } from '../../services/auth.service';
import { routes } from '../../app.routes';
import { CityService } from '../../services/city.service';

function car(make: string, over: Record<string, unknown> = {}) {
  return {
    id: `c-${make}`, make, model: 'Model', year: 2026, price: 900000, km: 0,
    fuel: 'Petrol', transmission: 'Manual', image: '', images: [],
    rating: 0, reviews: 0, verified: true, bodyType: 'SUV',
    ...over,
  } as any;
}

describe('navbar — New Cars menu', () => {
  let fixture: ComponentFixture<NavbarComponent>;
  let comp: NavbarComponent;

  function build(cars: any[]) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NavbarComponent],
      providers: [
        provideRouter([]),
        { provide: CarsDataService, useValue: { cars: signal(cars), loading: signal(false) } },
        {
          provide: AuthService,
          useValue: {
            currentUser: signal(null), isAdmin: () => false,
            isLoggedIn: signal(false), isSeller: () => false,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(NavbarComponent);
    comp = fixture.componentInstance;
    fixture.detectChanges();
  }

  function openMenu() {
    comp.toggleNewCars();
    fixture.detectChanges();
  }

  function menuLinks(): HTMLAnchorElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.nav-menu a'));
  }

  it('is closed until asked for', () => {
    build([car('Maruti Suzuki')]);
    expect(fixture.nativeElement.querySelector('.nav-menu')).toBeNull();

    openMenu();
    expect(fixture.nativeElement.querySelector('.nav-menu')).toBeTruthy();
  });

  it('points every entry at a route that exists', () => {
    build([car('Maruti Suzuki')]);
    openMenu();

    // The real table, not a copy — a route renamed in app.routes.ts fails here.
    const known = new Set(routes.map(r => `/${r.path}`));
    const hrefs = menuLinks().map(a => a.getAttribute('href') ?? '');
    expect(hrefs.length).toBeGreaterThan(4);

    for (const href of hrefs) {
      const path = href.split('?')[0].split('#')[0];
      expect(known.has(path)).withContext(`${href} has no route`).toBeTrue();
    }
  });

  it('carries the tools a new-car buyer asks for next', () => {
    // AI Advisor and Total Cost of Ownership were added by request. Asserted
    // by destination, not by label, so renaming the text cannot silently drop
    // the entry.
    build([car('Maruti Suzuki')]);
    openMenu();

    const hrefs = menuLinks().map(a => a.getAttribute('href') ?? '');
    expect(hrefs).toContain('/ai-advisor');
    expect(hrefs).toContain('/tco');
  });

  it('offers brands the catalogue actually has', () => {
    build([car('Maruti Suzuki'), car('Tata'), car('Maruti Suzuki', { id: 'c2' })]);
    openMenu();

    // De-duplicated, sorted, and only what is really there.
    expect(comp.newCarBrands()).toEqual(['Maruti Suzuki', 'Tata']);
  });

  it('drops the brand section rather than showing an empty one', () => {
    build([]);
    openMenu();

    expect(comp.newCarBrands()).toEqual([]);
    const groups = Array.from(fixture.nativeElement.querySelectorAll('.nav-menu-group'))
      .map(el => (el as HTMLElement).textContent?.trim());
    expect(groups).not.toContain('By brand');
  });

  it('ignores used cars when listing brands', () => {
    // A used Hyundai on the site does not mean we sell a new one.
    build([car('Maruti Suzuki'), car('Hyundai', { km: 42000 })]);
    openMenu();

    expect(comp.newCarBrands()).toEqual(['Maruti Suzuki']);
  });

  it('closes when the Used Cars menu opens', () => {
    // Two open panels overlap and the lower one is unreachable behind it.
    build([car('Maruti Suzuki')]);
    openMenu();

    comp.toggleUsedCars();
    fixture.detectChanges();

    expect(comp.newCarsOpen()).toBeFalse();
    expect(comp.usedCarsOpen()).toBeTrue();
  });

  it('closes on Escape, so a keyboard user is not trapped', () => {
    build([car('Maruti Suzuki')]);
    openMenu();

    comp.onEscape();
    fixture.detectChanges();

    expect(comp.newCarsOpen()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.nav-menu')).toBeNull();
  });
});

/**
 * The Used Cars menu.
 *
 * Same contract as the New Cars one — every entry has to resolve to a real
 * route — plus one thing that menu does not have: the query parameters it
 * builds must be the ones used-cars.component.ts actually reads. A chip
 * emitting `budget` instead of `maxBudget` would navigate, render, and quietly
 * apply no filter at all, which looks exactly like working.
 *
 * "Dealership Near Me" from the reference menu is absent on purpose: there is
 * no dealer directory behind it.
 */
describe('navbar — Used Cars menu', () => {
  let fixture: ComponentFixture<NavbarComponent>;
  let comp: NavbarComponent;

  function build(cars: any[], selectedCity: string | null = null) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NavbarComponent],
      providers: [
        provideRouter([]),
        { provide: CarsDataService, useValue: { cars: signal(cars), loading: signal(false) } },
        {
          provide: AuthService,
          useValue: {
            currentUser: signal(null), isAdmin: () => false,
            isLoggedIn: signal(false), isSeller: () => false,
          },
        },
        { provide: CityService, useValue: { selectedCity: signal(selectedCity) } },
      ],
    });
    fixture = TestBed.createComponent(NavbarComponent);
    comp = fixture.componentInstance;
    fixture.detectChanges();
    comp.toggleUsedCars();
    fixture.detectChanges();
  }

  function hrefs(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.nav-menu a'))
      .map(a => (a as HTMLAnchorElement).getAttribute('href') ?? '');
  }

  it('points every entry at a route that exists', () => {
    build([car('Tata', { km: 42000 })]);

    const known = new Set(routes.map(r => `/${r.path}`));
    const links = hrefs();
    expect(links.length).toBeGreaterThan(4);

    for (const href of links) {
      const path = href.split('?')[0].split('#')[0];
      expect(known.has(path)).withContext(`${href} has no route`).toBeTrue();
    }
  });

  it('filters by the parameter names the Used Cars page reads', () => {
    build([car('Tata', { km: 42000 })]);
    const links = hrefs();

    // used-cars.component.ts reads maxBudget, bodyType, fuel and make.
    expect(links.some(h => h.includes('maxBudget=300000'))).toBeTrue();
    expect(links.some(h => h.includes('bodyType=SUV'))).toBeTrue();
    expect(links.some(h => h.includes('fuel=Petrol'))).toBeTrue();
    expect(links.some(h => h.includes('make=Tata'))).toBeTrue();
  });

  it('offers only makes that have used stock', () => {
    // A brand-new Maruti on the site is not a used Maruti.
    build([car('Tata', { km: 42000 }), car('Maruti Suzuki', { km: 0 })]);

    expect(comp.usedCarBrands()).toEqual(['Tata']);
  });

  it('links straight to the chosen city, and asks when there is none', () => {
    build([car('Tata', { km: 42000 })], 'Kolkata');
    expect(hrefs().some(h => h.includes('city=Kolkata'))).toBeTrue();

    build([car('Tata', { km: 42000 })], null);
    // No city link at all — a picker button instead, so nothing pretends a
    // filter was applied.
    expect(hrefs().some(h => h.includes('city='))).toBeFalse();
    expect(fixture.nativeElement.querySelector('.nav-menu-btn')).toBeTruthy();
  });
});

/**
 * The two-row bar.
 *
 * One row of thirteen links had been shrunk to 0.86rem to fit at 1366px. The
 * split exists so the labels can be sized to read instead of sized to fit, so
 * what is pinned here is the split itself: if the AI row is ever folded back
 * into the first, the reason for the larger type goes with it.
 */
describe('navbar — two-row links', () => {
  let fixture: ComponentFixture<NavbarComponent>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NavbarComponent],
      providers: [
        provideRouter([]),
        { provide: CarsDataService, useValue: { cars: signal([]), loading: signal(false) } },
        {
          provide: AuthService,
          useValue: {
            currentUser: signal(null), isAdmin: () => false,
            isLoggedIn: signal(false), isSeller: () => false,
          },
        },
        { provide: CityService, useValue: { selectedCity: signal(null) } },
      ],
    });
    fixture = TestBed.createComponent(NavbarComponent);
    fixture.detectChanges();
  });

  it('puts the AI tools on their own row', () => {
    const ai = fixture.nativeElement.querySelector('.nav-row-ai');
    expect(ai).toBeTruthy();

    const hrefs = Array.from(ai.querySelectorAll('a'))
      .map(a => (a as HTMLAnchorElement).getAttribute('href'));
    expect(hrefs).toEqual(['/ai-advisor', '/vehicle-diagnosis', '/ai-valuation', '/find-mechanic']);
  });

  it('keeps the desktop rows hidden on mobile', () => {
    // The .hide-mobile class moved from the <ul> to the wrapper when the rows
    // were split; losing it would leave both rows on a phone behind the
    // hamburger.
    expect(fixture.nativeElement.querySelector('.nav-stack.hide-mobile')).toBeTruthy();
  });
});
