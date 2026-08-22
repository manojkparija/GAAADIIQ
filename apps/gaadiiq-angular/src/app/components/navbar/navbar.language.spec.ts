/**
 * The language picker.
 *
 * A list, not a toggle. A toggle labelled with the *other* language is
 * ambiguous — "हिन्दी" on a button reads as "you are in Hindi" to half the
 * people who see it. This shows the language in use and marks the current one
 * when open, so neither reading is possible.
 *
 * WHAT THIS DOES NOT COVER: most of the app's copy is hardcoded English. The
 * dictionary holds the navigation and about twenty other strings, so switching
 * to Hindi translates the bar and leaves page bodies in English. That is a
 * known gap, not something these tests assert away.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { NavbarComponent } from './navbar.component';
import { CarsDataService } from '../../services/cars-data.service';
import { AuthService } from '../../services/auth.service';
import { CityService } from '../../services/city.service';
import { LanguageService } from '../../services/language.service';

describe('navbar — language picker', () => {
  let fixture: ComponentFixture<NavbarComponent>;
  let comp: NavbarComponent;
  let lang: LanguageService;

  beforeEach(() => {
    localStorage.removeItem('gaadiiq_lang');
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
    comp = fixture.componentInstance;
    lang = TestBed.inject(LanguageService);
    fixture.detectChanges();
  });

  afterEach(() => localStorage.removeItem('gaadiiq_lang'));

  function navLabels(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.nav-links > li'))
      .map(li => ((li as HTMLElement).querySelector('a, .nav-dropdown-trigger') as HTMLElement)
        .textContent!.trim());
  }

  it('starts in English and names the language in use, not the other one', () => {
    expect(lang.lang()).toBe('en');
    // The trap this avoids: a button reading "हिन्दी" while the page is English.
    expect(comp.currentLangLabel()).toBe('English');
    expect(navLabels()[0]).toBe('Home');
  });

  it('offers both languages by their own names', () => {
    comp.toggleLang();
    fixture.detectChanges();

    const opts = Array.from(fixture.nativeElement.querySelectorAll('.lang-option'))
      .map(el => (el as HTMLElement).textContent!.trim());
    // Endonym: a Hindi reader has to be able to find their own language.
    expect(opts).toEqual(['English', 'हिन्दी']);
  });

  it('marks which language is in use', () => {
    comp.toggleLang();
    fixture.detectChanges();

    const current = fixture.nativeElement.querySelector('.lang-option.is-current');
    expect(current.textContent.trim()).toBe('English');
    expect(current.getAttribute('aria-selected')).toBe('true');
  });

  it('translates the bar when Hindi is chosen', () => {
    comp.chooseLang('hi');
    fixture.detectChanges();

    expect(lang.lang()).toBe('hi');
    expect(navLabels()[0]).toBe('होम');
    expect(comp.currentLangLabel()).toBe('हिन्दी');
    // Choosing closes the picker; leaving it open covers what just changed.
    expect(comp.langOpen()).toBeFalse();
  });

  it('remembers the choice for the next visit', () => {
    comp.chooseLang('hi');
    expect(localStorage.getItem('gaadiiq_lang')).toBe('hi');
  });

  it('falls back to English on a junk stored value', () => {
    // Anything can end up in localStorage; a bad value must not blank the bar.
    localStorage.setItem('gaadiiq_lang', 'kl');
    const svc = new LanguageService();
    expect(svc.lang()).toBe('en');
  });

  it('closes on Escape and when a menu opens', () => {
    comp.toggleLang();
    fixture.detectChanges();
    expect(comp.langOpen()).toBeTrue();

    comp.onEscape();
    expect(comp.langOpen()).toBeFalse();

    comp.toggleLang();
    comp.toggleNewCars();
    expect(comp.langOpen()).toBeFalse();
  });

  it('gives the same choice on mobile', () => {
    const opts = Array.from(fixture.nativeElement.querySelectorAll('.mobile-lang-option'))
      .map(el => (el as HTMLElement).textContent!.trim());
    expect(opts).toEqual(['English', 'हिन्दी']);
  });
});
