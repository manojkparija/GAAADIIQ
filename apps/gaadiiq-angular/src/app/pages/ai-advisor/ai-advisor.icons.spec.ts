/**
 * Every icon in the advisor is drawn the way its template draws it.
 *
 * WHAT WAS REPORTED
 *
 * Step 3 of the questionnaire showed the word "road" where a picture belongs,
 * and step 6 showed the word "car". Step 4 showed 🗺️ correctly.
 *
 * WHY
 *
 * `icon` is one field consumed two different ways:
 *
 *   ai-advisor.component.html:35   {{ currentStep()?.icon }}      raw text
 *   ai-advisor.component.html:75   <app-icon [name]="...icon">    icon name
 *
 * and the data mixed both kinds. A step carrying 'road' printed the letters;
 * a step carrying 🗺️ printed the picture. Nothing about the field said which
 * kind it held, so both spellings looked equally correct while writing it.
 *
 * THE HALF THAT WAS NOT REPORTED
 *
 * The same confusion ran the other way on the analysing screen, where two of
 * the five messages carried '🧮' and '✨' into <app-icon>. ICONS has no such
 * key, and the icon component's own note says an unknown name renders an
 * empty <svg> — so those two steps drew nothing at all, silently. Blank space
 * attracts no bug report, which is why only the reversed case was noticed.
 *
 * THE INVARIANT
 *
 * Rather than guess at each new entry: anything rendered as text must be an
 * emoji, and anything passed to <app-icon> must be a name ICONS actually has.
 * Both directions are checked below, because fixing one and leaving the other
 * is exactly how this arrived.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AiAdvisorComponent, ANALYZE_MSGS } from './ai-advisor.component';
import { ICONS } from '../../components/icon/icon.component';

/** The questions live on the component, so read them from a real instance. */
function steps() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AiAdvisorComponent, RouterTestingModule],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return TestBed.createComponent(AiAdvisorComponent).componentInstance.ALL_STEPS;
}

/** An icon name is ASCII; an emoji is not. */
function looksLikeEmoji(value: string): boolean {
  return !/^[\x20-\x7E]*$/.test(value);
}

describe('AI Advisor — icons render as pictures, not words', () => {
  it('gives every question an emoji, because the step icon is printed as text', () => {
    // The reported bug, stated as a rule. 'road' and 'car' were real icon
    // names — the data was not wrong so much as pointed at the wrong renderer.
    const printedAsWords = steps()
      .filter(q => !looksLikeEmoji(q.icon))
      .map(q => `${q.key}: ${q.icon}`);

    expect(printedAsWords).toEqual([]);
  });

  it('gives every analysing message a name the icon set actually has', () => {
    // The unreported half. An unknown name is not an error and not a
    // placeholder — it is an empty <svg>, which reads as a design choice.
    const drawNothing = ANALYZE_MSGS
      .filter(m => !(m.icon in ICONS))
      .map(m => m.icon);

    expect(drawNothing).toEqual([]);
  });

  it('keeps an emoji out of the icon-name list', () => {
    // Stated separately from the check above so a failure says which mistake
    // was made: an emoji here draws nothing, a typo'd name draws nothing, and
    // the fix differs.
    const emoji = ANALYZE_MSGS.filter(m => looksLikeEmoji(m.icon)).map(m => m.icon);

    expect(emoji).toEqual([]);
  });

  it('still holds twelve questions, eleven of them always shown', () => {
    // Guards the icon edits against having dropped or duplicated an entry.
    //
    // Twelve, not the eleven the screenshots show: the EV question carries
    // ev: true and visibleSteps() filters it out unless 'Electric' is among
    // the chosen fuels. That is also why its icon being wrong went unnoticed
    // for longer — most people never reach it.
    const all = steps();
    expect(all.length).toBe(12);
    expect(all.filter(q => !q.ev).length).toBe(11);
  });
});
