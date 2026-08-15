import { TestBed } from '@angular/core/testing';
import {
  VoiceDiagnosisService, VOICE_LANGUAGES, CONSENT_VERSION,
} from './voice-diagnosis.service';

describe('VoiceDiagnosisService', () => {
  let svc: VoiceDiagnosisService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    svc = TestBed.inject(VoiceDiagnosisService);
  });

  afterEach(() => localStorage.clear());

  // ── Consent (BR-SEC-01 / BR-SEC-04) ────────────────────────────────────────

  describe('microphone consent', () => {
    it('starts with no consent', () => {
      expect(svc.hasConsent()).toBeFalse();
    });

    it('grants consent and records version, timestamp and language', () => {
      const rec = svc.recordConsent(true);
      expect(svc.hasConsent()).toBeTrue();
      expect(rec.granted).toBeTrue();
      expect(rec.version).toBe(CONSENT_VERSION);
      expect(rec.language).toBe(svc.selectedLanguage().code);
      expect(new Date(rec.at).getTime()).not.toBeNaN();
    });

    it('a decline does not grant consent', () => {
      svc.recordConsent(false);
      expect(svc.hasConsent()).toBeFalse();
    });

    it('persists consent across service instances', () => {
      svc.recordConsent(true);
      const fresh = new VoiceDiagnosisService(TestBed.inject(TestBed as any) as any);
      expect(fresh.hasConsent()).toBeTrue();
    });

    it('emits an audit event for every decision', () => {
      const seen: boolean[] = [];
      svc.consentLogged.subscribe(r => seen.push(r.granted));
      svc.recordConsent(true);
      svc.recordConsent(false);
      expect(seen).toEqual([true, false]);
    });

    it('does not honour consent stored against an older notice version', () => {
      // A consent given under different terms must not carry over — the user
      // is asked again when the notice changes.
      localStorage.setItem('gq_voice_consent', JSON.stringify({
        granted: true, version: CONSENT_VERSION - 1,
        at: new Date().toISOString(), language: 'en-IN',
      }));
      const fresh = new VoiceDiagnosisService(TestBed.inject(TestBed as any) as any);
      expect(fresh.hasConsent()).toBeFalse();
    });

    it('survives a corrupt stored consent entry', () => {
      localStorage.setItem('gq_voice_consent', 'not-json');
      expect(() => new VoiceDiagnosisService(TestBed.inject(TestBed as any) as any)).not.toThrow();
    });

    it('revokes consent', () => {
      svc.recordConsent(true);
      svc.revokeConsent();
      expect(svc.hasConsent()).toBeFalse();
      expect(localStorage.getItem('gq_voice_consent')).toBeNull();
    });
  });

  // ── STT gating ─────────────────────────────────────────────────────────────

  describe('start() consent gate', () => {
    it('refuses to capture without consent', () => {
      const cb = jasmine.createSpy('onResult');
      svc.start(cb);
      expect(svc.state()).toBe('error');
      expect(svc.errorMessage()).toContain('Microphone permission');
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── Permission error map (BR-AND-01) ───────────────────────────────────────

  describe('permission error messages', () => {
    const messageFor = (name: string): string =>
      (svc as any)._permissionErrorMessage(name);

    it('names the missing-device case', () => {
      expect(messageFor('NotFoundError')).toContain('No microphone');
    });

    it('names the device-busy case', () => {
      expect(messageFor('NotReadableError')).toContain('in use by another app');
    });

    it('gives browser guidance when not in the native shell', () => {
      expect(messageFor('NotAllowedError')).toContain('address bar');
    });

    it('gives OS settings guidance in the native shell', () => {
      // The APK path must point at Settings, not the address bar.
      Object.defineProperty(svc, 'isNativeShell', { value: true, configurable: true });
      const msg = messageFor('NotAllowedError');
      expect(msg).toContain('Settings');
      expect(msg).toContain('Permissions');
    });

    it('never returns an empty message', () => {
      for (const n of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'WeirdError', '']) {
        expect(messageFor(n).length).toBeGreaterThan(10);
      }
    });
  });

  // ── Language ───────────────────────────────────────────────────────────────

  describe('language selection', () => {
    it('defaults to English', () => {
      expect(svc.selectedLanguage().code).toBe('en-IN');
    });

    it('persists the chosen language', () => {
      const hindi = VOICE_LANGUAGES.find(l => l.code === 'hi-IN')!;
      svc.selectLanguage(hindi);
      expect(localStorage.getItem('gq_voice_lang')).toBe('hi-IN');
    });

    it('exposes all 11 supported languages', () => {
      expect(VOICE_LANGUAGES.length).toBe(11);
      const codes = VOICE_LANGUAGES.map(l => l.code);
      for (const c of ['en-IN', 'hi-IN', 'bn-IN', 'ta-IN', 'te-IN', 'kn-IN',
                       'ml-IN', 'mr-IN', 'gu-IN', 'pa-IN', 'or-IN']) {
        expect(codes).toContain(c);
      }
    });

    it('auto-detects Hindi from Devanagari speech', () => {
      expect(svc.autoDetectLanguage('मेरी गाड़ी में आवाज आ रही है').code).toBe('hi-IN');
    });

    it('leaves English speech on English', () => {
      expect(svc.autoDetectLanguage('my car is making a noise').code).toBe('en-IN');
    });
  });

  // ── Mute preference ────────────────────────────────────────────────────────

  describe('mute', () => {
    it('toggles and persists', () => {
      expect(svc.muted()).toBeFalse();
      svc.toggleMute();
      expect(svc.muted()).toBeTrue();
      expect(localStorage.getItem('gq_voice_muted')).toBe('true');
    });
  });
});

// ── Android's re-delivered finals (production, Aug 15) ──────────────────────
//
// Chrome on desktop hands you each final once and advances resultIndex.
// Android's WebView engine re-delivers a GROWING final with resultIndex stuck
// at 0, so one sentence arrives as N finals, each a longer prefix of the last.
// Appending them produced this, verbatim, in the Render logs:
//
//   "got got it got it Tata got it Tata Safari got it Tata Safari 2024 …"
//
// which went to the model as the driver's symptoms. The model replied that the
// report contained no symptoms at all, which was correct.
describe('VoiceDiagnosisService transcript assembly', () => {
  let svc: VoiceDiagnosisService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    svc = TestBed.inject(VoiceDiagnosisService);
  });

  afterEach(() => localStorage.clear());

  /**
   * Arm the real recogniser.
   *
   * `_startRecognition()` constructs `window.SpeechRecognition` and installs
   * its handlers on the instance, so substituting the constructor is the only
   * seam that exercises the shipped `onresult` rather than a copy of it. If the
   * fake is never constructed the returned object has no `onresult` and the
   * expectations below fail loudly — this must not degrade into a skip.
   */
  function armed(): any {
    let instance: any = null;
    class FakeRecognition {
      lang = ''; continuous = false; interimResults = false; maxAlternatives = 1;
      onstart: any = null; onresult: any = null; onerror: any = null; onend: any = null;
      constructor() { instance = this; }
      start() { /* no audio in a unit test */ }
      stop() { /* ignore */ }
      abort() { /* ignore */ }
    }
    (window as any).SpeechRecognition = FakeRecognition;
    (svc as any).supported = true;
    svc.recordConsent(true);
    svc.start(() => { /* delivery is a separate concern */ });
    return instance;
  }

  /** One final result, as the engine exposes it. */
  const finalResult = (transcript: string) => {
    const r: any = [{ transcript, confidence: 0.9 }];
    r.isFinal = true;
    return r;
  };

  /** Drive the service's own onresult handler and read the buffer back. */
  const feed = (recognition: any, results: any, resultIndex: number) => {
    recognition.onresult({ resultIndex, results });
    return (svc as any).finalBuffer.trim();
  };

  afterEach(() => delete (window as any).SpeechRecognition);

  it('collapses Android re-delivered finals instead of stacking them', () => {
    const rec = armed();
    // Android's WebView re-delivers ONE final whose transcript grows, with
    // resultIndex stuck at 0. Appending each arrival built the staircase.
    const growing = [
      'got', 'got it', 'got it Tata', 'got it Tata Safari',
      'got it Tata Safari 2024', 'got it Tata Safari 2024 petrol',
      'got it Tata Safari 2024 petrol automatic',
    ];
    let buffer = '';
    for (const transcript of growing) {
      buffer = feed(rec, [finalResult(transcript)], 0);
    }
    expect(buffer).toBe('got it Tata Safari 2024 petrol automatic');
  });

  it('still assembles a well-behaved engine\'s separate finals', () => {
    const rec = armed();
    // Desktop Chrome: distinct phrases accumulate in `results`, resultIndex
    // advancing. Rebuilding must reproduce exactly what appending produced.
    const phrases = ['my Maruti Swift', '2019 petrol', 'manual transmission'];
    let buffer = '';
    for (let n = 1; n <= phrases.length; n++) {
      buffer = feed(rec, phrases.slice(0, n).map(finalResult), n - 1);
    }
    expect(buffer).toBe('my Maruti Swift 2019 petrol manual transmission');
  });
});
