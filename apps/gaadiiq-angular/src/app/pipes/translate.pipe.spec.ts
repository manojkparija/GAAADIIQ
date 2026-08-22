/**
 * The pipe, and the line it must not cross.
 *
 * Translation is a display concern. The risk in a codebase where the same
 * English word is both a label and a value — "Petrol" is what the chip says
 * AND what `?fuel=` carries — is that translating the label quietly translates
 * the filter, and the page returns nothing with no error anywhere. These tests
 * exist to make that failure loud.
 */
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { TranslatePipe } from './translate.pipe';
import { LanguageService } from '../services/language.service';
import { NavbarComponent } from '../components/navbar/navbar.component';
import { CarsDataService } from '../services/cars-data.service';
import { AuthService } from '../services/auth.service';
import { CityService } from '../services/city.service';

describe('TranslatePipe', () => {
  let pipe: TranslatePipe;
  let lang: LanguageService;

  beforeEach(() => {
    localStorage.removeItem('gaadiiq_lang');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [TranslatePipe] });
    pipe = TestBed.inject(TranslatePipe);
    lang = TestBed.inject(LanguageService);
  });

  afterEach(() => localStorage.removeItem('gaadiiq_lang'));

  it('passes English straight through in English', () => {
    expect(pipe.transform('All Cars')).toBe('All Cars');
  });

  it('translates in Hindi', () => {
    lang.set('hi');
    expect(pipe.transform('All Cars')).toBe('सभी कारें');
  });

  it('falls back to the English rather than showing a key', () => {
    lang.set('hi');
    // The whole point of keying by the sentence: an untranslated string reads
    // as it always did, instead of rendering "pages.foo.bar" to a user.
    const untranslated = 'A sentence nobody has translated yet';
    expect(pipe.transform(untranslated)).toBe(untranslated);
  });

  it('updates when the language changes', () => {
    // pure: false — a pure pipe would answer 'All Cars' forever.
    expect(pipe.transform('All Cars')).toBe('All Cars');
    lang.set('hi');
    expect(pipe.transform('All Cars')).toBe('सभी कारें');
    lang.set('en');
    expect(pipe.transform('All Cars')).toBe('All Cars');
  });
});

describe('translation does not reach business values', () => {
  function build(lang: 'en' | 'hi') {
    localStorage.setItem('gaadiiq_lang', lang);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NavbarComponent],
      providers: [
        provideRouter([]),
        {
          provide: CarsDataService,
          useValue: {
            cars: signal([{
              id: 'c1', make: 'Tata', model: 'Nexon', year: 2026, price: 900000,
              km: 42000, fuel: 'Petrol', transmission: 'Manual', image: '',
              images: [], rating: 0, reviews: 0, verified: true, bodyType: 'SUV',
            }]),
            loading: signal(false),
          },
        },
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
    const f = TestBed.createComponent(NavbarComponent);
    f.detectChanges();
    f.componentInstance.toggleUsedCars();
    f.detectChanges();
    return f;
  }

  afterEach(() => localStorage.removeItem('gaadiiq_lang'));

  it('keeps filter query parameters in English when the UI is Hindi', () => {
    const f = build('hi');
    const hrefs = Array.from(f.nativeElement.querySelectorAll('.nav-mega a'))
      .map(a => (a as HTMLAnchorElement).getAttribute('href') ?? '');

    // The chips read Hindi; what they ask the server for must not.
    expect(hrefs.some(h => h.includes('fuel=Petrol'))).withContext('fuel').toBeTrue();
    expect(hrefs.some(h => h.includes('bodyType=SUV'))).withContext('bodyType').toBeTrue();
    expect(hrefs.some(h => h.includes('make=Tata'))).withContext('make').toBeTrue();
    expect(hrefs.some(h => h.includes('maxBudget=300000'))).withContext('budget').toBeTrue();
  });

  it('builds the same links in both languages', () => {
    const en = Array.from(build('en').nativeElement.querySelectorAll('.nav-mega a'))
      .map(a => (a as HTMLAnchorElement).getAttribute('href'));
    const hi = Array.from(build('hi').nativeElement.querySelectorAll('.nav-mega a'))
      .map(a => (a as HTMLAnchorElement).getAttribute('href'));

    // Identical destinations; only the text between the tags differs.
    expect(hi).toEqual(en);
  });

  it('translates the group headings that are labels only', () => {
    const f = build('hi');
    const groups = Array.from(f.nativeElement.querySelectorAll('.nav-mega-head'))
      .map(el => (el as HTMLElement).textContent!.trim());
    expect(groups).toContain('बजट से');
    expect(groups).not.toContain('By budget');
  });
});
