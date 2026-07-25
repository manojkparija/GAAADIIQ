import { Injectable, signal, NgZone } from '@angular/core';

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

@Injectable({ providedIn: 'root' })
export class VoiceDiagnosisService {
  readonly supported = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  readonly synthSupported = 'speechSynthesis' in window;

  state = signal<RecordingState>('idle');
  interimText = signal('');
  errorMessage = signal('');
  selectedLanguage = signal<VoiceLanguage>(VOICE_LANGUAGES[0]);

  private recognition: any = null;
  private onFinal?: (text: string) => void;

  constructor(private zone: NgZone) {}

  selectLanguage(lang: VoiceLanguage) {
    this.selectedLanguage.set(lang);
  }

  start(onFinalResult: (text: string) => void) {
    if (!this.supported) {
      this.errorMessage.set('Voice input is not supported in this browser. Try Chrome or Edge.');
      this.state.set('error');
      return;
    }

    this.onFinal = onFinalResult;
    this.interimText.set('');
    this.errorMessage.set('');

    const SpeechRecognitionImpl =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    this.recognition = new SpeechRecognitionImpl();
    this.recognition.lang = this.selectedLanguage().code;
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => {
      this.zone.run(() => this.state.set('listening'));
    };

    this.recognition.onresult = (event: any) => {
      this.zone.run(() => {
        let interim = '';
        let finalChunk = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalChunk += transcript + ' ';
          } else {
            interim += transcript;
          }
        }
        this.interimText.set(interim);
        if (finalChunk.trim() && this.onFinal) {
          this.onFinal(finalChunk);
        }
      });
    };

    this.recognition.onerror = (event: any) => {
      this.zone.run(() => {
        const errMap: Record<string, string> = {
          'not-allowed': 'Microphone access denied. Please allow microphone permission and try again.',
          'no-speech': 'No speech detected. Please speak clearly and try again.',
          'network': 'Network error. Check your internet connection.',
          'audio-capture': 'No microphone found. Please connect a microphone.',
          'aborted': '',
        };
        const msg = errMap[event.error] ?? `Speech recognition error: ${event.error}`;
        if (msg) {
          this.errorMessage.set(msg);
          this.state.set('error');
        } else {
          this.state.set('idle');
        }
        this.interimText.set('');
      });
    };

    this.recognition.onend = () => {
      this.zone.run(() => {
        if (this.state() === 'listening') {
          this.state.set('idle');
        }
        this.interimText.set('');
      });
    };

    this.recognition.start();
  }

  stop() {
    if (this.recognition) {
      this.state.set('processing');
      this.recognition.stop();
      this.recognition = null;
      setTimeout(() => {
        this.zone.run(() => {
          if (this.state() === 'processing') this.state.set('idle');
        });
      }, 600);
    }
  }

  speak(text: string, langCode: string) {
    if (!this.synthSupported) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = langCode;
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }

  stopSpeaking() {
    if (this.synthSupported) window.speechSynthesis.cancel();
  }
}
