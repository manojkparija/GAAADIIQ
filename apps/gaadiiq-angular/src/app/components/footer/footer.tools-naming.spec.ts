/**
 * The footer names these for cars too — in both languages.
 *
 * REPORTED with the footer open and two links circled: "AI Valuation" under
 * SELL and "AI Car Advisor" under TOOLS, with "AI word should not be there".
 *
 * #292 renamed the navigation row, the mobile menu and one footer link, and
 * reported the footer as done. These two were not: "Car Diagnoses" beside them
 * had already been renamed, which is exactly why the column looked finished.
 * A second spec here rather than more cases in the navbar's: this file fails
 * for the footer, and says so in its name.
 *
 * THE ROUTES DO NOT MOVE. /ai-valuation and /ai-advisor stay as they are, for
 * the same reason as in #292 — a route is in bookmarks, in shared links and in
 * search results, and renaming one to match a label breaks all of those to fix
 * nothing a reader can see.
 *
 * THE TRANSLATION IS THE SILENT HALF. The pipe is keyed by the English
 * sentence, so 'Car Valuation' with no key in hindi.ts renders the English
 * back — no error, nothing in a log, just an untranslated link.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { FooterComponent } from './footer.component';
import { LanguageService } from '../../services/language.service';

function mount(): { fixture: ComponentFixture<FooterComponent>; lang: LanguageService } {
  localStorage.removeItem('gaadiiq_lang');
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [FooterComponent],
    providers: [provideRouter([])],
  });
  const fixture = TestBed.createComponent(FooterComponent);
  fixture.detectChanges();
  return { fixture, lang: TestBed.inject(LanguageService) };
}

describe('footer — the tool links are named for cars, not for AI', () => {
  // LanguageService.set() writes to localStorage, which outlives the TestBed
  // and left the whole suite in Hindi once already (fixed in #294). Cleared
  // after every case, not just the Hindi ones.
  afterEach(() => {
    try {
      localStorage.removeItem('gaadiiq_lang');
    } catch { /* private mode: nothing was stored to clear */ }
  });

  it('says neither of the circled labels', () => {
    const { fixture } = mount();
    const text: string = fixture.nativeElement.textContent ?? '';

    expect(text).toContain('Car Valuation');
    expect(text).toContain('Car Advisor');
    expect(text).not.toContain('AI Valuation');
    expect(text).not.toContain('AI Car Advisor');
  });

  it('keeps both routes exactly where they were', () => {
    const { fixture } = mount();
    const hrefs = Array.from(
      fixture.nativeElement.querySelectorAll('a'),
    ).map((a: any) => a.getAttribute('href'));

    expect(hrefs).toContain('/ai-valuation');
    expect(hrefs).toContain('/ai-advisor');
  });

  it('translates the renamed links into Hindi', () => {
    const { lang } = mount();
    lang.set('hi');

    expect(lang.translate('Car Valuation')).toBe('कार मूल्यांकन');
    expect(lang.translate('Car Advisor')).toBe('कार सलाहकार');
  });

  it('does not fall through to English for either', () => {
    // Asserting the Devanagari above would still pass if someone set the value
    // to the English string. This cannot.
    const { lang } = mount();
    lang.set('hi');

    for (const label of ['Car Valuation', 'Car Advisor']) {
      expect(lang.translate(label))
        .withContext(`"${label}" fell through to English`)
        .not.toBe(label);
    }
  });

  it('renders the Hindi in the footer when Hindi is chosen', () => {
    const { fixture, lang } = mount();
    lang.set('hi');
    fixture.detectChanges();
    const text: string = fixture.nativeElement.textContent ?? '';

    expect(text).toContain('कार मूल्यांकन');
    expect(text).not.toContain('Car Valuation');
  });

  it('keeps the old keys, because other pages still use those words', () => {
    // The pricing table still lists "AI Valuation" and "AI Car Advisor" as
    // plan features. Dropping these keys would un-translate that table.
    const { lang } = mount();
    lang.set('hi');

    expect(lang.translate('AI Valuation')).toBe('AI मूल्यांकन');
    expect(lang.translate('AI Car Advisor')).toBe('AI कार सलाहकार');
  });
});
