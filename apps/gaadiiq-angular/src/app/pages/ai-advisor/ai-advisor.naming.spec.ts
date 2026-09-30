/**
 * The advisor page's own heading says "Car Advisor".
 *
 * REPORTED with the page open and the hero circled: "Remove AI word".
 *
 * WHY THE EARLIER PASSES MISSED IT
 *
 * The heading is built from two keys, because the gradient runs on the second
 * word only:
 *
 *     <h1>{{ 'AI Car' | t }} <span>{{ 'Advisor' | t }}</span></h1>
 *
 * So the string "AI Car Advisor" never existed whole anywhere in the source.
 * #292 renamed the navigation and #295 the footer, both found by searching for
 * that phrase, and both searches were blind to this heading — it reads as
 * "AI Car Advisor" on screen and as two unrelated words in a grep.
 *
 * That is what this file pins: the RENDERED heading, not the keys behind it.
 * A later change that splits or rejoins the words differently still has to
 * pass it.
 *
 * The route is unchanged, for the reason #292 gives: a route is in bookmarks,
 * in shared links, in search results and in chat.service.ts's "Open AI
 * Advisor" prompt.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { AiAdvisorComponent } from './ai-advisor.component';
import { LanguageService } from '../../services/language.service';

function mount(): { fixture: ComponentFixture<AiAdvisorComponent>; lang: LanguageService } {
  localStorage.removeItem('gaadiiq_lang');
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AiAdvisorComponent],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(AiAdvisorComponent);
  fixture.detectChanges();
  return { fixture, lang: TestBed.inject(LanguageService) };
}

/** The heading as a reader sees it, with the two spans joined back up. */
function heading(fixture: ComponentFixture<AiAdvisorComponent>): string {
  const h1 = fixture.nativeElement.querySelector('.advisor-hero h1');
  return (h1?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('AiAdvisorComponent — the page is named for cars, not for AI', () => {
  afterEach(() => {
    try {
      localStorage.removeItem('gaadiiq_lang');
    } catch { /* private mode: nothing was stored to clear */ }
  });

  it('heads the page "Car Advisor"', () => {
    // THE REPORTED LINE. Asserted on the joined text because the words live in
    // separate elements — which is how it survived two renames.
    const { fixture } = mount();

    expect(heading(fixture)).toBe('Car Advisor');
  });

  it('says "AI" nowhere in the heading', () => {
    // Deliberately a substring check, so "AI Car", "Car AI Advisor" or any
    // other rearrangement fails too, not just today's exact wording.
    const { fixture } = mount();

    expect(heading(fixture)).not.toContain('AI');
  });

  it('heads it in Hindi without the word either', () => {
    // The pipe is keyed by the English sentence, so a heading key with no
    // entry renders the English back — no error, just an untranslated title.
    const { fixture, lang } = mount();
    lang.set('hi');
    fixture.detectChanges();

    expect(heading(fixture)).toBe('कार सलाहकार');
  });

  it('does not offer to "Ask AI" on the chat button', () => {
    // The button lives in the results phase, not the quiz the page opens on —
    // which is why it needs switching here, and why nobody had read it.
    const { fixture } = mount();
    (fixture.componentInstance as any).phase.set('results');
    fixture.detectChanges();
    const fab = fixture.nativeElement.querySelector('.chat-fab');

    expect(fab).withContext('the chat button did not render').toBeTruthy();

    expect(fab?.textContent ?? '').not.toContain('AI');
    expect(fab?.getAttribute('aria-label')).toBe('Ask Car Advisor');
  });
});
