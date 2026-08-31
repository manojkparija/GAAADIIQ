/**
 * What the spoken report actually contains.
 *
 * Reported: the possible causes were never read aloud. They were on the screen
 * and absent from the audio, so a driver listening hands-free — the whole point
 * of the voice flow — heard what the fault might be and nothing about why.
 *
 * The text is assembled by _buildTtsText, which had the preliminary diagnosis,
 * the safety warning, the recommended steps and the follow-up questions, and
 * simply never mentioned `possible_causes`. Nothing failed; the sentence was
 * not there to begin with, which is why no error ever appeared.
 *
 * Confidence is spoken with each cause, as it is displayed. A cause read out
 * bare sounds like a finding rather than a possibility, and this application
 * does not present uncertain things as certain (see CLAUDE.md on credit
 * scores).
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { VehicleDiagnosisComponent } from './vehicle-diagnosis.component';

function build(report: any): string {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [VehicleDiagnosisComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { queryParams: {} } } },
    ],
  });
  const c = TestBed.createComponent(VehicleDiagnosisComponent).componentInstance as any;
  return c._buildTtsText(report);
}

const REPORT = {
  preliminary_diagnosis: 'Brake Squeal / Brake Fade.',
  safe_to_drive: true,
  possible_causes: [
    { cause: 'Worn brake pads', confidence: 75, explanation: 'symptoms matching known cases' },
    { cause: 'Glazed rotors', confidence: 60, explanation: 'symptoms matching known cases' },
    { cause: 'Air in brake lines', confidence: 45, explanation: 'symptoms matching known cases' },
  ],
  recommended_steps: ['Have the vehicle inspected by a certified mechanic'],
  needs_more_info: false,
  follow_up_questions: [],
};

describe('VehicleDiagnosisComponent — the spoken report', () => {
  it('reads the possible causes aloud', () => {
    // The reported gap.
    const spoken = build(REPORT);

    expect(spoken).toContain('Worn brake pads');
    expect(spoken).toContain('Glazed rotors');
    expect(spoken).toContain('Air in brake lines');
  });

  it('speaks each cause with its confidence', () => {
    const spoken = build(REPORT);

    expect(spoken).toContain('Worn brake pads, 75 percent confidence');
  });

  it('still leads with the preliminary diagnosis', () => {
    // Order matters to someone driving: the headline first, then the reasoning.
    const spoken = build(REPORT);

    expect(spoken.indexOf('Brake Squeal')).toBeLessThan(spoken.indexOf('Worn brake pads'));
  });

  it('puts the do-not-drive warning before the causes', () => {
    // Safety outranks explanation. Someone may stop listening after the first
    // sentence, and this is the sentence that must not be missed.
    const spoken = build({ ...REPORT, safe_to_drive: false });

    expect(spoken.indexOf('Do not drive')).toBeLessThan(spoken.indexOf('Worn brake pads'));
  });

  it('keeps the recommended steps after the causes', () => {
    const spoken = build(REPORT);

    expect(spoken.indexOf('Worn brake pads'))
      .toBeLessThan(spoken.indexOf('Have the vehicle inspected'));
  });

  it('caps the list at three', () => {
    // The server refuses a synthesis over 3000 characters, and the screen
    // shows three. A long tail of low-confidence guesses helps nobody.
    const spoken = build({
      ...REPORT,
      possible_causes: [
        ...REPORT.possible_causes,
        { cause: 'Contaminated brake fluid', confidence: 20, explanation: '' },
      ],
    });

    expect(spoken).not.toContain('Contaminated brake fluid');
  });

  it('omits a confidence the engine did not give', () => {
    // The heuristic fallback can return a cause with no score, and "null
    // percent confidence" would be worse than saying nothing.
    const spoken = build({
      ...REPORT,
      possible_causes: [{ cause: 'Worn brake pads', confidence: null, explanation: '' }],
    });

    expect(spoken).toContain('Worn brake pads');
    expect(spoken).not.toContain('percent confidence');
  });

  it('says nothing about causes when there are none', () => {
    const spoken = build({ ...REPORT, possible_causes: [] });

    expect(spoken).not.toContain('Possible causes');
  });

  it('still asks the follow-up questions last', () => {
    // BR-AI-10: a listener must learn the assessment was uncertain.
    const spoken = build({
      ...REPORT,
      needs_more_info: true,
      follow_up_questions: ['Does the noise change with speed?'],
    });

    expect(spoken.indexOf('Worn brake pads'))
      .toBeLessThan(spoken.indexOf('Does the noise change with speed?'));
  });
});

describe('VehicleDiagnosisComponent — the model\'s own spoken summary', () => {
  /*
   * The scaffolding around the values — "Preliminary diagnosis:", "Possible
   * causes:", "Recommended next steps:" — was hardcoded English, so a Hindi or
   * Tamil report was read out wrapped in English. Hand-writing labels for
   * eleven languages would mean translations nobody here can verify.
   *
   * Instead the model that already writes every value in the driver's language
   * writes the spoken text too. Nothing is invented and nothing is translated
   * twice. The assembly below stays for the heuristic engine, which returns no
   * summary and speaks only English anyway.
   */
  it('speaks what the model wrote for listening', () => {
    const spoken = build({ ...REPORT, spoken_summary: 'Your brake pads are worn.' });

    expect(spoken).toBe('Your brake pads are worn.');
  });

  it('does not wrap it in English labels', () => {
    // The whole point: no "Preliminary diagnosis:" in front of Hindi prose.
    const spoken = build({
      ...REPORT,
      spoken_summary: 'आपके ब्रेक पैड घिस गए हैं।',
    });

    expect(spoken).not.toContain('Preliminary diagnosis');
    expect(spoken).not.toContain('Possible causes');
  });

  it('falls back to assembling the report when there is no summary', () => {
    // The heuristic engine. English labels are honest there.
    const spoken = build({ ...REPORT, spoken_summary: '' });

    expect(spoken).toContain('Preliminary diagnosis');
    expect(spoken).toContain('Worn brake pads');
  });

  it('falls back when the field is missing entirely', () => {
    // An older report read back from history, saved before this field existed.
    const spoken = build(REPORT);

    expect(spoken).toContain('Preliminary diagnosis');
  });
});
