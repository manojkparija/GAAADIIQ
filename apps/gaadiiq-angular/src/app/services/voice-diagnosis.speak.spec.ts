/**
 * The diagnosis is read aloud on Android too.
 *
 * Reported from the installed APK: the AI diagnosis never spoke, while the
 * same report spoke normally on the website.
 *
 * WHY THE OLD PATH LOOKED FINE
 *
 * Speech output went through `window.speechSynthesis` and nothing else
 * (voice-diagnosis.service.ts). Android's WebView exposes that object, accepts
 * an utterance, and produces no sound — so every check passed, no error was
 * raised anywhere, and the feature was simply inaudible. A capability check
 * cannot detect this: `'speechSynthesis' in window` is true on the phone where
 * it does not work, which is why the service now decides by platform rather
 * than by feature detection.
 *
 * The device engine is used instead, so Hindi and the other Indian languages
 * use whatever voices the user has installed. Nothing here changes the
 * website: every native branch is behind `native.isNative`.
 */
import { TestBed } from '@angular/core/testing';

import { VoiceDiagnosisService, VOICE_LANGUAGES } from './voice-diagnosis.service';
import { NativeService } from './native.service';

function mount(isNative: boolean, spoken = true) {
  TestBed.resetTestingModule();
  const native = {
    isNative,
    speak: jasmine.createSpy('speak').and.resolveTo(spoken),
    stopSpeaking: jasmine.createSpy('stopSpeaking').and.resolveTo(undefined),
  };
  TestBed.configureTestingModule({
    providers: [{ provide: NativeService, useValue: native }],
  });
  const svc = TestBed.inject(VoiceDiagnosisService);
  svc.muted.set(false);
  return { svc, native };
}

describe('VoiceDiagnosisService — speaking the report', () => {
  let synthSpeak: jasmine.Spy;

  beforeEach(() => {
    // Present but mute, exactly as in the Android WebView.
    synthSpeak = spyOn(window.speechSynthesis, 'speak').and.stub();
    spyOn(window.speechSynthesis, 'cancel').and.stub();
    localStorage.removeItem('gq_voice_muted');
  });

  it('speaks through the device engine on Android', async () => {
    const { svc, native } = mount(true);

    svc.speak('Your AC compressor may be failing.');
    await Promise.resolve();

    expect(native.speak).toHaveBeenCalled();
    expect(native.speak.calls.mostRecent().args[0])
      .toBe('Your AC compressor may be failing.');
  });

  it('does not use the WebView synthesiser on Android', async () => {
    // The reported bug. Speaking here is silence, not speech.
    const { svc } = mount(true);

    svc.speak('Brake pads worn.');
    await Promise.resolve();

    expect(synthSpeak).not.toHaveBeenCalled();
  });

  it('passes the selected language to the device engine', async () => {
    // A Hindi report read by an English voice is the failure this replaces.
    const { svc, native } = mount(true);
    svc.selectedLanguage.set(VOICE_LANGUAGES.find(l => l.code === 'hi-IN')!);

    svc.speak('एसी ठीक से काम नहीं कर रहा है।');
    await Promise.resolve();

    expect(native.speak.calls.mostRecent().args[1]).toBe('hi-IN');
  });

  it('falls back to the browser when the device has no voice', async () => {
    // No TTS data installed for that locale. Saying nothing would be worse.
    const { svc } = mount(true, /* spoken */ false);

    svc.speak('Brake pads worn.');
    await Promise.resolve();
    await Promise.resolve();

    expect(synthSpeak).toHaveBeenCalled();
  });

  it('uses the browser on the web, untouched', async () => {
    const { svc, native } = mount(false);

    svc.speak('Brake pads worn.');
    await Promise.resolve();

    expect(native.speak).not.toHaveBeenCalled();
    expect(synthSpeak).toHaveBeenCalled();
  });

  it('stays silent when muted', async () => {
    const { svc, native } = mount(true);
    svc.muted.set(true);

    svc.speak('Brake pads worn.');
    await Promise.resolve();

    expect(native.speak).not.toHaveBeenCalled();
    expect(synthSpeak).not.toHaveBeenCalled();
  });

  it('stops the device engine when speech is cancelled', async () => {
    // Closing the overlay must not leave the phone reading the report out.
    const { svc, native } = mount(true);

    svc.speak('Brake pads worn.');
    await Promise.resolve();
    svc.stopSpeaking();

    expect(native.stopSpeaking).toHaveBeenCalled();
    expect(svc.speakingState()).toBe('idle');
  });

  it('returns to idle once the device finishes', async () => {
    const { svc } = mount(true);

    svc.speak('Brake pads worn.');
    await Promise.resolve();
    await Promise.resolve();

    expect(svc.speakingState()).toBe('idle');
  });
});

describe('VoiceDiagnosisService — whether the UI offers speech at all', () => {
  // The report came back as text with no Listen control on the phone. The
  // service had been taught to speak natively, but the template still gated
  // the whole TTS bar on `synthSupported` — feature detection, which is
  // exactly the check that does not answer this question on Android.
  it('offers speech on a native platform', () => {
    const { svc } = mount(true);

    expect(svc.canSpeak).withContext('the Listen bar must be reachable').toBeTrue();
  });

  it('offers speech in a browser that has speechSynthesis', () => {
    const { svc } = mount(false);

    expect(svc.canSpeak).toBe(svc.synthSupported);
  });

  it('does not offer pause on a native platform', () => {
    // The device plugin can stop but not pause, so the control would be dead.
    const { svc } = mount(true);

    expect(svc.canPause).toBeFalse();
  });

  it('offers pause in a browser', () => {
    const { svc } = mount(false);

    expect(svc.canPause).toBe(svc.synthSupported);
  });
});
