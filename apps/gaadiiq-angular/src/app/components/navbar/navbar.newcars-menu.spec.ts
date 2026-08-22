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

  it('closes on Escape, so a keyboard user is not trapped', () => {
    build([car('Maruti Suzuki')]);
    openMenu();

    comp.onEscape();
    fixture.detectChanges();

    expect(comp.newCarsOpen()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.nav-menu')).toBeNull();
  });
});
