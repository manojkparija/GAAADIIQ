import { Injectable, signal, NgZone } from '@angular/core';
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

  private recognition: any = null;
  private onFinal?: (text: string) => void;
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
    }
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
    this.onFinal = onFinalResult;
    this.interimText.set('');
    this.errorMessage.set('');
    this.lastConfidence.set(null);
    this._startRecognition();
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

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0].transcript;
          const confidence = result[0].confidence ?? 0;
          if (confidence > maxConfidence) maxConfidence = confidence;

          if (result.isFinal) {
            finalChunk += transcript + ' ';
          } else {
            interim += transcript;
          }
        }

        this.interimText.set(interim);
        if (maxConfidence > 0) this.lastConfidence.set(Math.round(maxConfidence * 100));

        if (finalChunk.trim() && this.onFinal) {
          this.onFinal(finalChunk);
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
            setTimeout(() => this._startRecognition(), 800);
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
    };

    this.recognition.start();
  }

  stop() {
    if (this.recognition) {
      this.recognition.stop();
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
