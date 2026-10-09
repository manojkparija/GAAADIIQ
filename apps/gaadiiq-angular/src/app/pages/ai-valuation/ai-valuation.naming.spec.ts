/**
 * The valuation page's badge and button are named for cars.
 *
 * REPORTED with the page open, the hero badge circled and an arrow reading
 * "Car Valuation". So "AI Valuation" becomes "Car Valuation", matching the
 * "Car Value" tab highlighted in the navigation directly above it.
 *
 * THE BUTTON GOES WITH IT
 *
 * "Get AI Valuation" sits further down the same page and names the same
 * feature. Renaming only the circled badge is the mistake #295 already made
 * once — a column where one of three labels had been renamed read as finished,
 * and the other two survived two passes.
 *
 * WHAT IS DELIBERATELY LEFT, AND WHY IT MATTERS MORE THAN THE RENAME
 *
 * Two strings on this page tell the reader where their number came from:
 *
 *   "AI-enhanced when available"
 *   r.method === 'claude' ? '🤖 AI-powered' : '📐 Formula estimate'
 *
 * The second is a provenance badge: it says whether this figure came from the
 * model or from the depreciation formula. That distinction is the page being
 * honest about a number a seller will act on, and it is the same principle as
 * services/credit_bureau.py refusing to invent a score. Stripping "AI" there
 * would not be a tidy-up, it would delete the disclosure.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { AiValuationComponent } from './ai-valuation.component';
import { LanguageService } from '../../services/language.service';

function mount(): {
  fixture: ComponentFixture<AiValuationComponent>;
  lang: LanguageService;
} {
  localStorage.removeItem('gaadiiq_lang');
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AiValuationComponent],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(AiValuationComponent);
  fixture.detectChanges();
  return { fixture, lang: TestBed.inject(LanguageService) };
}

function badge(fixture: ComponentFixture<AiValuationComponent>): string {
  const el = fixture.nativeElement.querySelector('.ai-badge');
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('AiValuationComponent — the badge and button are named for cars', () => {
  afterEach(() => {
    try {
      localStorage.removeItem('gaadiiq_lang');
    } catch { /* private mode: nothing was stored to clear */ }
  });

  it('reads "Car Valuation" on the badge', () => {
    const { fixture } = mount();

    expect(badge(fixture)).toBe('Car Valuation');
    expect(badge(fixture)).not.toContain('AI');
  });

  it('offers "Get Car Valuation" on the button', () => {
    // The half that renaming only the circled badge would have left behind.
    const { fixture } = mount();
    const text: string = fixture.nativeElement.textContent ?? '';

    expect(text).toContain('Get Car Valuation');
    expect(text).not.toContain('Get AI Valuation');
  });

  it('translates both new names into Hindi', () => {
    const { lang } = mount();
    lang.set('hi');

    expect(lang.translate('Car Valuation')).toBe('कार मूल्यांकन');
    expect(lang.translate('Get Car Valuation')).toBe('कार मूल्यांकन पाएं');
  });

  it('does not fall through to English for either', () => {
    const { lang } = mount();
    lang.set('hi');

    for (const label of ['Car Valuation', 'Get Car Valuation']) {
      expect(lang.translate(label))
        .withContext(`"${label}" fell through to English`)
        .not.toBe(label);
    }
  });

  it('keeps the old key the pricing table still uses', () => {
    // NARROWED, and the reason matters. This case used to assert two keys on
    // the grounds that "the pricing table still uses them". That is true of
    // 'AI Valuation' — pricing-plans.component.html:103 lists it as a plan
    // feature, and the home page names it in the sell CTA. It was never true of
    // 'Get AI Valuation': grepping every .html and .ts finds that string only
    // inside this spec file. It was a translation for a label no page rendered,
    // kept alive by the test that asserted it.
    //
    // The home hero adopted 'Get Car Valuation' — which #299 had already added,
    // Hindi and all, without switching the button to it — so the old key now
    // has no caller at all and has been deleted from hindi.ts.
    const { lang } = mount();
    lang.set('hi');

    expect(lang.translate('AI Valuation')).toBe('AI मूल्यांकन');
  });

  it('still tells the reader when the figure was AI-enhanced', () => {
    // NOT an oversight. This says where a number a seller will act on came
    // from, and the rename must never quietly remove it.
    const { fixture } = mount();
    const text: string = fixture.nativeElement.textContent ?? '';

    expect(text).toContain('AI-enhanced when available');
  });
});
