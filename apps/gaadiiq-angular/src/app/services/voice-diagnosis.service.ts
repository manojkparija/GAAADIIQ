import { Injectable, signal, NgZone, EventEmitter } from '@angular/core';
import { detectLanguageFromText } from '../utils/vehicle-info-extractor';

export interface VoiceLanguage {
  code: string;
  label: string;
  native: string;
}

export const VOICE_LANGUAGES: VoiceLanguage[] = [
  { code: 'en-IN', label: 'English', native: 'English' },
  { code: 'hi-IN', label: 'Hindi', native: 'हिन्दी' },
  { code: 'bn-IN', label: 'Bengali', native: 'বাংলা' },
  { code: 'ta-IN', label: 'Tamil', native: 'தமிழ்' },
  { code: 'te-IN', label: 'Telugu', native: 'తెలుగు' },
  { code: 'kn-IN', label: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml-IN', label: 'Malayalam', native: 'മലയാളം' },
  { code: 'mr-IN', label: 'Marathi', native: 'मराठी' },
  { code: 'gu-IN', label: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'pa-IN', label: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'or-IN', label: 'Odia', native: 'ଓଡ଼ିଆ' },
];

export type RecordingState = 'idle' | 'listening' | 'processing' | 'error';
export type SpeakingState = 'idle' | 'speaking' | 'paused';

const MUTE_KEY = 'gq_voice_muted';
const LANG_KEY = 'gq_voice_lang';
const CONSENT_KEY = 'gq_voice_consent';

/**
 * Consent notice version. Bump when the purpose, retention period or data
 * handling changes — a stored consent at an older version is not valid for
 * the new terms and the user is re-asked (BR-SEC-04).
 */
export const CONSENT_VERSION = 1;

/** How long voice-derived data is kept; surfaced in the consent notice. */
export const VOICE_RETENTION_NOTICE =
  'Audio is transcribed and immediately discarded — recordings are never stored. ' +
  'The resulting text is kept with your diagnosis so you can review it later, ' +
  'and is deleted when you delete that diagnosis.';

/** Audit record of an explicit microphone consent decision (BR-SEC-01/04). */
export interface MicConsentRecord {
  granted: boolean;
  version: number;  // CONSENT_VERSION at the time of the decision
  at: string;       // ISO timestamp
  language: string; // language active when consent was given
}

/** How long to wait after the last final phrase before treating the answer as
 *  complete. Long enough for the pause between "my Maruti Swift" and "2019
 *  petrol"; short enough that the conversation does not feel stalled. */
const FINAL_SILENCE_MS = 1100;

@Injectable({ providedIn: 'root' })
export class VoiceDiagnosisService {
  readonly supported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  readonly synthSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // STT signals
  state = signal<RecordingState>('idle');
  interimText = signal('');
  errorMessage = signal('');
  lastConfidence = signal<number | null>(null);
  noSpeechRetries = signal(0);

  // TTS signals
  speakingState = signal<SpeakingState>('idle');
  muted = signal(false);

  // Language
  selectedLanguage = signal<VoiceLanguage>(VOICE_LANGUAGES[0]);
  autoDetectedLanguage = signal<VoiceLanguage | null>(null);

  // Microphone consent (TC-F-19, TC-S-05)
  micConsent = signal<MicConsentRecord | null>(null);

  private recognition: any = null;
  private onFinal: ((text: string) => void) | null = null;

  /** Final phrases heard since the microphone opened, not yet delivered. */
  private finalBuffer = '';
  private deliverTimer: ReturnType<typeof setTimeout> | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private pendingSpeakText = '';

  constructor(private zone: NgZone) {
    if (typeof window !== 'undefined') {
      this.muted.set(localStorage.getItem(MUTE_KEY) === 'true');
      const saved = localStorage.getItem(LANG_KEY);
      if (saved) {
        const lang = VOICE_LANGUAGES.find(l => l.code === saved);
        if (lang) this.selectedLanguage.set(lang);
      }
      const consent = localStorage.getItem(CONSENT_KEY);
      if (consent) {
        try { this.micConsent.set(JSON.parse(consent)); } catch { /* corrupt entry — re-ask */ }
      }
    }
  }

  // ── Microphone consent ────────────────────────────────────────────────────

  /**
   * True only when consent was granted AND against the current notice version.
   * A stored consent from an older version does not cover revised terms, so
   * the user is asked again (BR-SEC-04).
   */
  hasConsent(): boolean {
    const c = this.micConsent();
    return c?.granted === true && c.version === CONSENT_VERSION;
  }

  /**
   * Record an explicit consent decision. Persisted so the prompt is shown once,
   * and emitted as an audit event so consent is provably logged before any
   * audio capture begins (BR-SEC-01).
   */
  recordConsent(granted: boolean): MicConsentRecord {
    const record: MicConsentRecord = {
      granted,
      version: CONSENT_VERSION,
      at: new Date().toISOString(),
      language: this.selectedLanguage().code,
    };
    this.micConsent.set(record);
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify(record)); } catch { /* private mode */ }
    this.consentLogged.emit(record);
    return record;
  }

  /** Fires whenever a consent decision is made, for analytics/audit sinks. */
  readonly consentLogged = new EventEmitter<MicConsentRecord>();

  /** Clear stored consent — used by the "delete my voice data" control. */
  revokeConsent() {
    this.micConsent.set(null);
    try { localStorage.removeItem(CONSENT_KEY); } catch { /* ignore */ }
  }

  // ── OS-level microphone permission (BR-AND-01) ────────────────────────────

  /** True when running inside the Capacitor Android/iOS shell. */
  readonly isNativeShell = typeof window !== 'undefined' &&
    !!(window as any).Capacitor?.isNativePlatform?.();

  permissionDenied = signal(false);

  /**
   * Request OS microphone permission before starting capture.
   *
   * In-app consent (recordConsent) and OS permission are different gates: the
   * user can accept our notice and still have the platform block the mic. This
   * surfaces that case explicitly rather than failing silently.
   *
   * Returns true when the mic is usable.
   */
  async ensureMicPermission(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      // No getUserMedia: the Web Speech API triggers its own prompt, so let
      // the caller proceed and surface any error through the STT error map.
      return true;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Release immediately — this call is only a permission probe.
      stream.getTracks().forEach(t => t.stop());
      this.permissionDenied.set(false);
      return true;
    } catch (err: any) {
      const name = err?.name ?? '';
      this.permissionDenied.set(true);
      this.state.set('error');
      this.errorMessage.set(this._permissionErrorMessage(name));
      return false;
    }
  }

  /** Actionable guidance for a permission failure — never a silent failure. */
  private _permissionErrorMessage(errorName: string): string {
    if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
      return 'No microphone was found. Connect a microphone and try again.';
    }
    if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
      return 'Your microphone is in use by another app. Close it and try again.';
    }
    // NotAllowedError / PermissionDeniedError, and anything unrecognised.
    return this.isNativeShell
      ? 'Microphone access is blocked. Open Settings → Apps → GAADIIQ → Permissions and enable Microphone, then try again.'
      : 'Microphone access is blocked. Tap the lock icon in the address bar, allow Microphone, then reload the page.';
  }

  // ── Language ──────────────────────────────────────────────────────────────

  selectLanguage(lang: VoiceLanguage) {
    this.selectedLanguage.set(lang);
    localStorage.setItem(LANG_KEY, lang.code);
  }

  /** Auto-detect language from spoken text and update selectedLanguage if non-English detected. */
  autoDetectLanguage(text: string): VoiceLanguage {
    const code = detectLanguageFromText(text);
    const lang = VOICE_LANGUAGES.find(l => l.code === code) ?? VOICE_LANGUAGES[0];
    this.autoDetectedLanguage.set(code !== 'en-IN' ? lang : null);
    if (code !== 'en-IN') {
      this.selectedLanguage.set(lang);
      // Update recognition language for next recording session
    }
    return lang;
  }

  // ── STT ──────────────────────────────────────────────────────────────────

  start(onFinalResult: (text: string) => void) {
    if (!this.supported) {
      this.errorMessage.set('Voice input is not supported in this browser. Please use Chrome or Edge.');
      this.state.set('error');
      return;
    }
    // Consent gate — no audio capture may begin without a recorded decision
    // (TC-F-19). Callers must show the consent prompt and call recordConsent().
    if (!this.hasConsent()) {
      this.errorMessage.set('Microphone permission is required for voice diagnosis.');
      this.state.set('error');
      return;
    }
    this.onFinal = onFinalResult;
    this.interimText.set('');
    this.errorMessage.set('');
    this.lastConfidence.set(null);
    this._startRecognition();
  }

  /** Hand the accumulated transcript to the caller exactly once.
   *
   * The callback advances the conversation, so calling it twice skips a step —
   * and with `continuous = true` a late result from a recogniser that has
   * already been stopped could do exactly that. Clearing `onFinal` here is what
   * makes the delivery single-shot.
   */
  private _deliverFinal() {
    if (this.deliverTimer) {
      clearTimeout(this.deliverTimer);
      this.deliverTimer = null;
    }
    const text = this.finalBuffer.trim();
    this.finalBuffer = '';
    const cb = this.onFinal;
    if (!text || !cb) return;
    this.onFinal = null;
    this.zone.run(() => cb(text));
  }

  /**
   * Fold a freshly-read set of finals into what we already hold.
   *
   * Engines disagree about what `event.results` contains, and guessing wrong
   * either duplicates words or loses them:
   *
   *  - The spec says `results` holds every result received so far, and desktop
   *    Chrome obeys it. Each event therefore re-states the earlier phrases,
   *    and appending would repeat them.
   *  - Android's WebView re-delivers ONE final whose transcript grows, with
   *    `resultIndex` stuck at 0 — the same shape, and again a superset.
   *  - Some engines (and our own e2e double) hand over only the new phrase.
   *    Replacing there would throw away everything said before it, which is
   *    how "my Maruti Swift 2019 petrol manual" became "manual transmission".
   *
   * Containment tells the two apart without having to know which engine is
   * running: if the incoming text already carries what we hold, it supersedes
   * it; otherwise it is new speech and belongs on the end.
   */
  private _mergeFinals(held: string, incoming: string): string {
    const a = held.trim();
    const b = incoming.trim();
    if (!a) return incoming;
    if (b.includes(a)) return incoming;   // a superset — supersedes
    if (a.includes(b)) return held;       // a stale repeat — already held
    return `${a} ${b} `;                  // genuinely new speech
  }

  private _startRecognition() {
    const SpeechRecognitionImpl =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    this.recognition = new SpeechRecognitionImpl();
    this.recognition.lang = this.selectedLanguage().code;
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.zone.run(() => {
        this.state.set('listening');
        this.noSpeechRetries.set(0);
      });
    };

    this.recognition.onresult = (event: any) => {
      this.zone.run(() => {
        let interim = '';
        let finalChunk = '';
        let maxConfidence = 0;

        // Rebuild the finals from the WHOLE results list, every time, rather
        // than appending what arrived since `resultIndex`.
        //
        // Chrome on desktop hands you each final once and moves resultIndex
        // along, so appending works. Android's WebView engine does not: it
        // re-delivers a GROWING final result with resultIndex stuck at 0, so
        // "Tata Safari 2024 petrol automatic" arrives as seven successive
        // finals, each one a longer prefix of the last. Appending them
        // produced the staircase seen in production:
        //
        //   "got got it got it Tata got it Tata Safari got it Tata Safari
        //    2024 got it Tata Safari 2024 petrol got it …"
        //
        // — which then went to the model as the driver's symptoms, and the
        // model correctly replied that it contained no symptoms at all.
        //
        // Rebuilding is idempotent: `event.results` holds every result for the
        // session, so on a well-behaved engine this produces exactly what
        // appending did, and on a re-delivering one the repeats collapse.
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0].transcript;
          const confidence = result[0].confidence ?? 0;
          if (confidence > maxConfidence) maxConfidence = confidence;

          if (result.isFinal) {
            finalChunk += transcript + ' ';
          } else if (i >= event.resultIndex) {
            // Interim text is display-only, so only the newest matters.
            interim += transcript;
          }
        }

        this.interimText.set(interim);
        if (maxConfidence > 0) this.lastConfidence.set(Math.round(maxConfidence * 100));

        // Accumulate, then deliver once the speaker actually stops.
        //
        // `continuous = true` makes the engine emit a final result per phrase,
        // so "my Maruti Swift 2019 petrol manual" arrives as three or four
        // separate finals. Delivering the first one immediately — which is what
        // this did — called back with "my Maruti Swift", stopped the mic, and
        // threw the year, fuel and transmission away. That is the whole of
        // "it isn't capturing the car details properly".
        if (finalChunk.trim()) {
          this.finalBuffer = this._mergeFinals(this.finalBuffer, finalChunk);
          if (this.deliverTimer) clearTimeout(this.deliverTimer);
          this.deliverTimer = setTimeout(() => this._deliverFinal(), FINAL_SILENCE_MS);
        }
      });
    };

    this.recognition.onerror = (event: any) => {
      this.zone.run(() => {
        this.interimText.set('');

        if (event.error === 'no-speech') {
          const retries = this.noSpeechRetries();
          if (retries < 2) {
            // Auto-retry up to 2 times for noisy environments
            this.noSpeechRetries.set(retries + 1);
            this.errorMessage.set(`No speech detected (attempt ${retries + 1}/3). Please speak clearly…`);
            // Abort the old instance first. Constructing a second recogniser
            // and calling start() while the first is alive throws
            // InvalidStateError out of the timer, uncaught, and the microphone
            // never reopens — the retry that was meant to help is what kills
            // the session.
            try { this.recognition?.abort(); } catch { /* already gone */ }
            this.recognition = null;
            setTimeout(() => {
              try {
                this._startRecognition();
              } catch (err) {
                this.zone.run(() => {
                  this.errorMessage.set('Could not restart the microphone. Tap the mic to try again.');
                  this.state.set('error');
                });
              }
            }, 800);
            return;
          }
          this.errorMessage.set('No speech detected after 3 attempts. Please speak closer to the mic or reduce background noise.');
          this.state.set('error');
          return;
        }

        const errMap: Record<string, string> = {
          'not-allowed': 'Microphone access denied. Allow mic permission in your browser and try again.',
          'network': 'Network error during speech recognition. Check your internet connection.',
          'audio-capture': 'No microphone detected. Connect a mic and try again.',
          'service-not-allowed': 'Speech service not allowed. Ensure the site is served over HTTPS.',
          'aborted': '',
        };
        const msg = errMap[event.error] ?? `Speech recognition error: ${event.error}`;
        if (msg) {
          this.errorMessage.set(msg);
          this.state.set('error');
        } else {
          this.state.set('idle');
        }
      });
    };

    this.recognition.onend = () => {
      this.zone.run(() => {
        if (this.state() === 'listening') this.state.set('idle');
        this.interimText.set('');
      });
      // The engine stopped while a phrase was still buffered — deliver it
      // rather than discard it. Losing the user's last sentence because the
      // recogniser timed out is indistinguishable, to them, from not listening.
      if (this.finalBuffer.trim()) this._deliverFinal();
    };

    try {
      this.recognition.start();
    } catch (err) {
      // Chrome throws InvalidStateError if a recogniser is already running.
      // Unhandled, this leaves the UI showing "Listening…" with a microphone
      // that is not open.
      this.zone.run(() => {
        this.errorMessage.set('Microphone is busy. Tap the mic to try again.');
        this.state.set('error');
      });
      this.recognition = null;
    }
  }

  stop() {
    if (this.deliverTimer) {
      clearTimeout(this.deliverTimer);
      this.deliverTimer = null;
    }
    // Deliver anything already heard before tearing the recogniser down.
    if (this.finalBuffer.trim()) this._deliverFinal();
    this.finalBuffer = '';
    // Clearing the callback is the other half of single-shot delivery: a late
    // onresult from the instance being stopped must not advance the
    // conversation a second time.
    this.onFinal = null;
    if (this.recognition) {
      try { this.recognition.stop(); } catch { /* already stopped */ }
      this.recognition = null;
    }
    this.zone.run(() => this.state.set('idle'));
    this.interimText.set('');
  }

  dismissError() {
    this.errorMessage.set('');
    this.state.set('idle');
    this.noSpeechRetries.set(0);
  }

  // ── TTS ──────────────────────────────────────────────────────────────────

  speak(text: string) {
    if (!this.synthSupported) return;
    this.pendingSpeakText = text;
    if (this.muted()) return;
    this._doSpeak(text);
  }

  private _doSpeak(text: string) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.selectedLanguage().code;
    utterance.rate = 0.88;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onstart = () => this.zone.run(() => this.speakingState.set('speaking'));
    utterance.onpause = () => this.zone.run(() => this.speakingState.set('paused'));
    utterance.onresume = () => this.zone.run(() => this.speakingState.set('speaking'));
    utterance.onend = () => this.zone.run(() => this.speakingState.set('idle'));
    utterance.onerror = () => this.zone.run(() => this.speakingState.set('idle'));

    this.currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  pauseSpeaking() {
    if (this.synthSupported && this.speakingState() === 'speaking') {
      window.speechSynthesis.pause();
    }
  }

  resumeSpeaking() {
    if (this.synthSupported && this.speakingState() === 'paused') {
      window.speechSynthesis.resume();
    }
  }

  stopSpeaking() {
    if (this.synthSupported) {
      window.speechSynthesis.cancel();
    }
    this.speakingState.set('idle');
    this.currentUtterance = null;
  }

  replaySpeaking() {
    if (this.pendingSpeakText) {
      this._doSpeak(this.pendingSpeakText);
    }
  }

  toggleMute() {
    const next = !this.muted();
    this.muted.set(next);
    localStorage.setItem(MUTE_KEY, String(next));
    if (next) {
      this.stopSpeaking();
    } else if (this.pendingSpeakText && this.speakingState() === 'idle') {
      this._doSpeak(this.pendingSpeakText);
    }
  }

  destroy() {
    this.stop();
    this.stopSpeaking();
    this.pendingSpeakText = '';
  }
}
