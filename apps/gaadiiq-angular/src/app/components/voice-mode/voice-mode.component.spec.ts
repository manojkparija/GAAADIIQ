/**
 * Echo stripping.
 *
 * Production logs showed a `problem_description` that began with the
 * assistant's own confirmation — "ठीक है मारुति स्विफ्ट 2010 पेट्रोल मैन्युअल
 * अब कृपया अपनी गाड़ी की समस्या बताइए" — followed by the driver's actual
 * symptom. The prompt was still audible when the microphone opened, so the
 * recogniser transcribed it, and the model was then asked to diagnose our own
 * question.
 *
 * The timing fix (a speech budget that scales with the sentence) is the
 * primary cure. This is the guarantee: on a phone with the speaker on, a tail
 * can always leak back in.
 */

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { VoiceModeComponent } from './voice-mode.component';

describe('VoiceModeComponent echo stripping', () => {
  let component: any;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [VoiceModeComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    component = TestBed.createComponent(VoiceModeComponent).componentInstance;
  });

  const strip = (spoken: string, heard: string) => {
    component._lastSpoken = spoken;
    return component._stripSpokenPrompt(heard);
  };

  it('removes the Hindi confirmation the recogniser echoed back', () => {
    // The exact shape seen in production.
    const prompt = 'ठीक है मारुति स्विफ्ट 2010 पेट्रोल मैन्युअल अब कृपया अपनी गाड़ी की समस्या बताइए';
    const heard = `${prompt} गाड़ी की इंजन काफी हिट हो रही है`;
    expect(strip(prompt, heard)).toBe('गाड़ी की इंजन काफी हिट हो रही है');
  });

  it('removes an English prompt echo', () => {
    const prompt = 'Got it — Maruti Swift 2010. Now please describe the problem with your vehicle.';
    const heard = 'Got it Maruti Swift 2010 Now please describe the problem with your vehicle my brakes are squealing';
    expect(strip(prompt, heard)).toBe('my brakes are squealing');
  });

  it('leaves a genuine answer untouched', () => {
    const prompt = 'And the year?';
    expect(strip(prompt, 'my car is a 2010 Maruti Swift')).toBe('my car is a 2010 Maruti Swift');
  });

  it('does not strip on a short accidental overlap', () => {
    // Two matching words is a coincidence, not an echo. Stripping a real
    // answer is worse than leaving an echo in.
    const prompt = 'My vehicle needs checking';
    const heard = 'My vehicle makes a grinding noise when I brake';
    expect(strip(prompt, heard)).toBe(heard);
  });

  it('never returns nothing, even when the echo is the whole transcript', () => {
    // An empty answer would send the flow round again with nothing to show.
    const prompt = 'Now please describe the problem with your vehicle';
    expect(strip(prompt, prompt)).toBe(prompt);
  });

  it('is unaffected when nothing has been spoken', () => {
    component._lastSpoken = '';
    expect(component._stripSpokenPrompt('engine is overheating')).toBe('engine is overheating');
  });

  it('matches despite punctuation and case differences', () => {
    // TTS reads punctuation that the recogniser does not transcribe.
    const prompt = 'Got it, Maruti Swift. Now, describe the problem:';
    const heard = 'got it maruti swift now describe the problem the engine is overheating';
    expect(strip(prompt, heard)).toBe('the engine is overheating');
  });
});
