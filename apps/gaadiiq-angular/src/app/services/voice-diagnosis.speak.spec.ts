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
import { ServerTtsService } from './server-tts.service';

function mount(isNative: boolean, spoken = true, serverPlayed = false) {
  TestBed.resetTestingModule();
  const native = {
    isNative,
    speak: jasmine.createSpy('speak').and.resolveTo(spoken),
    lastSpeakError: '',
    stopSpeaking: jasmine.createSpy('stopSpeaking').and.resolveTo(undefined),
  };
  const serverTts = {
    speak: jasmine.createSpy('serverSpeak').and.resolveTo(serverPlayed),
    stop: jasmine.createSpy('serverStop'),
    lastError: '',
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: NativeService, useValue: native },
      { provide: ServerTtsService, useValue: serverTts },
    ],
  });
  const svc = TestBed.inject(VoiceDiagnosisService);
  svc.muted.set(false);
  return { svc, native, serverTts };
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

describe('VoiceDiagnosisService — when the device cannot speak', () => {
  // Silence with no explanation is what made this take several rounds to
  // diagnose: the plugin's reason was caught and discarded, so the phone
  // showed a report, no sound, and nothing to act on.
  beforeEach(() => {
    spyOn(window.speechSynthesis, 'speak').and.stub();
    spyOn(window.speechSynthesis, 'cancel').and.stub();
    localStorage.removeItem('gq_voice_muted');
  });

  it('says so on screen rather than failing silently', async () => {
    const { svc } = mount(true, /* spoken */ false);

    svc.speak('Brake pads worn.');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(svc.errorMessage()).toContain('Could not read this report aloud');
  });

  it('carries the underlying reason through', async () => {
    // The only evidence anyone investigating will have.
    const { svc, native } = mount(true, /* spoken */ false);
    (native as any).lastSpeakError = 'not installed';

    svc.speak('Brake pads worn.');
    await Promise.resolve();
    await Promise.resolve();

    expect(svc.errorMessage()).toContain('not installed');
  });

  it('says nothing when the device speaks fine', async () => {
    const { svc } = mount(true, /* spoken */ true);

    svc.speak('Brake pads worn.');
    await Promise.resolve();
    await Promise.resolve();

    expect(svc.errorMessage()).toBe('');
  });
});

describe('VoiceDiagnosisService — server speech as the fallback', () => {
  /*
   * Telling a Play Store user to open Settings → Accessibility → Text-to-speech
   * and install voice data is a debugging step, not a product: almost nobody
   * will do it, and the report is silent for everyone who does not. Android
   * ships very little Indian-language voice data, so that is not a rare case.
   *
   * So when the device engine cannot speak, the audio is synthesised on the
   * server (/diagnosis/tts, which existed and had never been called) and
   * played here. The user is never asked to configure anything and never
   * learns which path ran.
   *
   * The device engine stays first: it is free, instant and offline, and the
   * server bills per character.
   */
  beforeEach(() => {
    spyOn(window.speechSynthesis, 'speak').and.stub();
    spyOn(window.speechSynthesis, 'cancel').and.stub();
    localStorage.removeItem('gq_voice_muted');
  });

  it('does not call the server when the device speaks', async () => {
    // The common case, and the one that must stay free.
    const { svc, serverTts } = mount(true, /* deviceSpoke */ true);

    svc.speak('Brake pads worn.');
    await Promise.resolve();
    await Promise.resolve();

    expect(serverTts.speak).not.toHaveBeenCalled();
  });

  it('falls back to the server when the phone has no voice', async () => {
    const { svc, serverTts } = mount(true, /* deviceSpoke */ false, /* served */ true);

    svc.speak('Brake pads worn.');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(serverTts.speak).toHaveBeenCalled();
    expect(serverTts.speak.calls.mostRecent().args[0]).toBe('Brake pads worn.');
  });

  it('sends the chosen language to the server', async () => {
    const { svc, serverTts } = mount(true, false, true);
    svc.selectedLanguage.set(VOICE_LANGUAGES.find(l => l.code === 'or-IN')!);

    svc.speak('ପରୀକ୍ଷା');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(serverTts.speak.calls.mostRecent().args[1]).toBe('or-IN');
  });

  it('says nothing when the server rescues it', async () => {
    // The whole point: the user hears the report and sees no error.
    const { svc } = mount(true, false, /* served */ true);

    svc.speak('Brake pads worn.');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(svc.errorMessage()).toBe('');
  });

  it('reports only when device and server have both failed', async () => {
    const { svc } = mount(true, false, /* served */ false);

    svc.speak('Brake pads worn.');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(svc.errorMessage()).toContain('Could not read this report aloud');
  });

  it('no longer tells the user to install voice data', async () => {
    // The instruction this change exists to remove.
    const { svc } = mount(true, false, false);

    svc.speak('Brake pads worn.');
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(svc.errorMessage()).not.toContain('Settings');
    expect(svc.errorMessage()).not.toContain('Text-to-speech');
  });

  it('stops server audio when speech is cancelled', async () => {
    const { svc, serverTts } = mount(true, false, true);

    svc.stopSpeaking();

    expect(serverTts.stop).toHaveBeenCalled();
  });
});
