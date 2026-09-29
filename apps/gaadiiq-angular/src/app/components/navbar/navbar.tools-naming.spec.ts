/**
 * The tools row says "Car", not "AI" — in both languages.
 *
 * REQUESTED: replace the "AI" word in the navigation with Car Advisor, Car
 * Diagnoses and Car Value, "makesure no business logic should be impacted and
 * the exiting flow should work flawlessly".
 *
 * TWO THINGS COULD HAVE BROKEN, AND BOTH ARE ASSERTED HERE
 *
 * 1. THE TRANSLATION. The pipe is keyed by the English sentence, not by a
 *    code, and its own docstring names the cost: "editing English copy
 *    silently drops its translation". `'AI Advisor': 'AI सलाहकार'` is looked
 *    up by the string "AI Advisor". Renaming the label to "Car Advisor"
 *    without adding a key would have left a Hindi reader looking at English —
 *    no error, no crash, nothing in a log, just an untranslated bar.
 *
 * 2. THE ROUTES. `/ai-advisor`, `/vehicle-diagnosis` and `/ai-valuation` are
 *    deliberately unchanged. A route is not copy: it is in bookmarks, in
 *    whatever links have been shared, in search results, and in
 *    chat.service.ts's "Open AI Advisor" prompt. Renaming one to match a label
 *    would break all of those to fix nothing a reader can see.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';

import { NavbarComponent } from './navbar.component';
import { CarsDataService } from '../../services/cars-data.service';
import { AuthService } from '../../services/auth.service';
import { CityService } from '../../services/city.service';
import { LanguageService } from '../../services/language.service';

function mount(): { fixture: ComponentFixture<NavbarComponent>; lang: LanguageService } {
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
  const fixture = TestBed.createComponent(NavbarComponent);
  fixture.detectChanges();
  return { fixture, lang: TestBed.inject(LanguageService) };
}

describe('navbar — the tools row is named for cars, not for AI', () => {
  it('shows the three renamed labels', () => {
    const { fixture } = mount();
    const labels = (fixture.componentInstance as any).aiTabs.map((t: any) => t.label);

    expect(labels).toEqual(['Car Advisor', 'Car Diagnoses', 'Car Value', 'Find Mechanic']);
  });

  it('says none of them in English on the rendered bar', () => {
    const { fixture } = mount();
    const text: string = fixture.nativeElement.textContent ?? '';

    expect(text).toContain('Car Advisor');
    expect(text).not.toContain('AI Advisor');
    expect(text).not.toContain('AI Diagnosis');
    expect(text).not.toContain('AI Car Value');
  });

  it('keeps the routes exactly where they were', () => {
    // The part that would break bookmarks and shared links if it moved.
    const { fixture } = mount();
    const links = (fixture.componentInstance as any).aiTabs.map((t: any) => t.link);

    expect(links).toEqual([
      '/ai-advisor', '/vehicle-diagnosis', '/ai-valuation', '/find-mechanic',
    ]);
  });

  it('still translates each one into Hindi', () => {
    // THE SILENT FAILURE. Without new keys these return the English string
    // back, which looks like a working pipe and is not.
    const { lang } = mount();
    lang.set('hi');

    expect(lang.translate('Car Advisor')).toBe('कार सलाहकार');
    expect(lang.translate('Car Diagnoses')).toBe('कार जांच');
    expect(lang.translate('Car Value')).toBe('कार मूल्य');
  });

  it('translates them to something other than the English', () => {
    // Asserting the exact Devanagari above would still pass if someone set
    // the value to the English string. This cannot.
    const { lang } = mount();
    lang.set('hi');

    for (const label of ['Car Advisor', 'Car Diagnoses', 'Car Value']) {
      expect(lang.translate(label))
        .withContext(`"${label}" fell through to English`)
        .not.toBe(label);
    }
  });

  it('keeps the old keys, because other pages still use those words', () => {
    // The pricing table, the quota messages and the privacy policy still call
    // the feature "AI Diagnosis". Dropping these keys would un-translate them.
    const { lang } = mount();
    lang.set('hi');

    expect(lang.translate('AI Diagnosis')).toBe('AI जांच');
    expect(lang.translate('AI Advisor')).toBe('AI सलाहकार');
  });

  it('renders the Hindi labels on the bar when Hindi is chosen', () => {
    const { fixture, lang } = mount();
    lang.set('hi');
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent ?? '';

    expect(text).toContain('कार सलाहकार');
    expect(text).not.toContain('Car Advisor');
  });
});
