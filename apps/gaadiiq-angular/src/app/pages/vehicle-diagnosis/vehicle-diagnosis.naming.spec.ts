/**
 * The diagnosis page's badge is named for cars.
 *
 * REPORTED with the page open, the hero badge circled and an arrow: "put Car
 * in AI place". So "AI Repair Advisor" becomes "Car Repair Advisor", matching
 * the "Car Diagnoses" tab that is highlighted in the navigation directly above
 * it in the same screenshot.
 *
 * WHAT IS DELIBERATELY NOT RENAMED, AND WHY IT IS NOT AN OVERSIGHT
 *
 * The rest of this page's "AI" wording describes the processing rather than
 * naming the feature, and some of it is a disclosure:
 *
 *   "This AI analysis is a preliminary assessment only. It is not a
 *    professional diagnosis. Always consult a certified mechanic..."
 *
 * Telling a reader their report came from AI is the honest thing to do, and
 * the same reasoning kept "AI Diagnosis" in the privacy policy during #292.
 * Stripping the word from a safety disclaimer would make the page say less
 * than it should, which is the opposite of a tidy-up.
 *
 * The old Hindi key is kept too, because the quota and sign-in messages on
 * this very page still call the feature "AI Diagnosis" and the pricing table
 * lists it that way. Dropping the key would un-translate those.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { VehicleDiagnosisComponent } from './vehicle-diagnosis.component';
import { LanguageService } from '../../services/language.service';

function mount(): {
  fixture: ComponentFixture<VehicleDiagnosisComponent>;
  lang: LanguageService;
} {
  localStorage.removeItem('gaadiiq_lang');
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [VehicleDiagnosisComponent],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(VehicleDiagnosisComponent);
  fixture.detectChanges();
  return { fixture, lang: TestBed.inject(LanguageService) };
}

function badge(fixture: ComponentFixture<VehicleDiagnosisComponent>): string {
  const el = fixture.nativeElement.querySelector('.hero-badge');
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('VehicleDiagnosisComponent — the hero badge is named for cars', () => {
  afterEach(() => {
    try {
      localStorage.removeItem('gaadiiq_lang');
    } catch { /* private mode: nothing was stored to clear */ }
  });

  it('reads "Car Repair Advisor"', () => {
    const { fixture } = mount();

    expect(badge(fixture)).toBe('Car Repair Advisor');
  });

  it('says "AI" nowhere in the badge', () => {
    // A substring check, so a later rearrangement fails too rather than only
    // today's exact wording.
    const { fixture } = mount();

    expect(badge(fixture)).not.toContain('AI');
  });

  it('translates the new name into Hindi', () => {
    // The pipe is keyed by the English sentence, so a renamed label with no
    // key renders the English back — no error, just an untranslated badge.
    const { lang } = mount();
    lang.set('hi');

    expect(lang.translate('Car Repair Advisor')).toBe('कार मरम्मत सलाहकार');
  });

  it('does not fall through to English', () => {
    // Asserting the Devanagari above would still pass if someone set the value
    // to the English string. This cannot.
    const { lang } = mount();
    lang.set('hi');

    expect(lang.translate('Car Repair Advisor')).not.toBe('Car Repair Advisor');
  });

  it('renders the Hindi badge when Hindi is chosen', () => {
    const { fixture, lang } = mount();
    lang.set('hi');
    fixture.detectChanges();

    expect(badge(fixture)).toBe('कार मरम्मत सलाहकार');
  });

  it('keeps the old key, because other copy still uses that name', () => {
    const { lang } = mount();
    lang.set('hi');

    expect(lang.translate('AI Repair Advisor')).toBe('AI मरम्मत सलाहकार');
  });

  it('leaves the safety disclaimer saying the analysis came from AI', () => {
    // NOT an oversight. A reader is entitled to know a machine produced their
    // report, and this sentence is the page's disclaimer. Renaming the badge
    // must never quietly strip that.
    const { fixture } = mount();
    const text: string = fixture.nativeElement.textContent ?? '';

    expect(text).toContain('AI-powered');
  });
});
