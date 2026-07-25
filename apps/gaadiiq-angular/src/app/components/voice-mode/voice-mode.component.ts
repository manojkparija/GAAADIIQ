import {
  Component, Output, EventEmitter, signal, computed,
  OnDestroy, OnInit, inject, NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { VoiceDiagnosisService, VOICE_LANGUAGES, VoiceLanguage } from '../../services/voice-diagnosis.service';
import { extractVehicleInfo, ExtractedVehicleInfo } from '../../utils/vehicle-info-extractor';
import { environment } from '../../../environments/environment';

export interface VoiceSessionResult {
  vehicleInfo: Partial<ExtractedVehicleInfo>;
  problemDescription: string;
  detectedLanguage: string;
}

type ConversationStep =
  | 'select-language'
  | 'greeting'
  | 'capture-vehicle'
  | 'confirm-vehicle'
  | 'capture-problem'
  | 'processing'
  | 'done';

interface Message {
  role: 'ai' | 'user';
  text: string;
}

/** Localized conversation prompts, keyed by language code. */
interface Prompts {
  greeting: string;
  /** Asked when nothing was captured from the last utterance. */
  askField: (label: string) => string;
  /** Asked after capturing something — acknowledges it, then asks for the next field. */
  gotThenAsk: (got: string, label: string) => string;
  confirm: (summary: string) => string;
  thanks: string;
  fields: Record<string, string>;
}

const PROMPTS: Record<string, Prompts> = {
  'en-IN': {
    greeting: 'Hello! Please tell me about your vehicle — the brand, model, year, fuel type and transmission.',
    askField: (l) => `I didn't catch the ${l}. Could you please tell me that?`,
    gotThenAsk: (g, l) => `Got ${g}. And the ${l}?`,
    confirm: (s) => `Got it — ${s}. Now please describe the problem with your vehicle.`,
    thanks: 'Thank you! Sending your details for AI diagnosis now.',
    fields: {
      manufacturer: 'vehicle brand', model: 'model name', model_year: 'year',
      fuel_type: 'fuel type', transmission: 'transmission type',
    },
  },
  'hi-IN': {
    greeting: 'नमस्ते! कृपया अपनी गाड़ी के बारे में बताइए — ब्रांड, मॉडल, साल, फ्यूल टाइप और ट्रांसमिशन।',
    askField: (l) => `मुझे ${l} समझ नहीं आया। कृपया दोबारा बताइए।`,
    gotThenAsk: (g, l) => `${g} मिल गया। और ${l}?`,
    confirm: (s) => `ठीक है — ${s}। अब कृपया अपनी गाड़ी की समस्या बताइए।`,
    thanks: 'धन्यवाद! आपकी जानकारी AI डायग्नोसिस के लिए भेजी जा रही है।',
    fields: {
      manufacturer: 'गाड़ी का ब्रांड', model: 'मॉडल का नाम', model_year: 'साल',
      fuel_type: 'फ्यूल टाइप', transmission: 'ट्रांसमिशन',
    },
  },
  'bn-IN': {
    greeting: 'নমস্কার! অনুগ্রহ করে আপনার গাড়ি সম্পর্কে বলুন — ব্র্যান্ড, মডেল, বছর, জ্বালানি এবং ট্রান্সমিশন।',
    askField: (l) => `আমি ${l} বুঝতে পারিনি। অনুগ্রহ করে আবার বলুন।`,
    gotThenAsk: (g, l) => `${g} পেয়েছি। এবার ${l}?`,
    confirm: (s) => `ঠিক আছে — ${s}। এখন আপনার গাড়ির সমস্যা বলুন।`,
    thanks: 'ধন্যবাদ! আপনার তথ্য AI ডায়াগনোসিসের জন্য পাঠানো হচ্ছে।',
    fields: {
      manufacturer: 'গাড়ির ব্র্যান্ড', model: 'মডেলের নাম', model_year: 'বছর',
      fuel_type: 'জ্বালানির ধরন', transmission: 'ট্রান্সমিশন',
    },
  },
  'ta-IN': {
    greeting: 'வணக்கம்! உங்கள் வாகனத்தைப் பற்றி கூறுங்கள் — பிராண்ட், மாடல், ஆண்டு, எரிபொருள் மற்றும் டிரான்ஸ்மிஷன்.',
    askField: (l) => `எனக்கு ${l} புரியவில்லை. மீண்டும் கூறுங்கள்.`,
    gotThenAsk: (g, l) => `${g} கிடைத்தது. இப்போது ${l}?`,
    confirm: (s) => `சரி — ${s}. இப்போது உங்கள் வாகனத்தின் பிரச்சனையைக் கூறுங்கள்.`,
    thanks: 'நன்றி! உங்கள் விவரங்கள் AI நோயறிதலுக்கு அனுப்பப்படுகிறது.',
    fields: {
      manufacturer: 'வாகன பிராண்ட்', model: 'மாடல் பெயர்', model_year: 'ஆண்டு',
      fuel_type: 'எரிபொருள் வகை', transmission: 'டிரான்ஸ்மிஷன்',
    },
  },
  'te-IN': {
    greeting: 'నమస్కారం! దయచేసి మీ వాహనం గురించి చెప్పండి — బ్రాండ్, మోడల్, సంవత్సరం, ఇంధనం మరియు ట్రాన్స్‌మిషన్.',
    askField: (l) => `నాకు ${l} అర్థం కాలేదు. దయచేసి మళ్లీ చెప్పండి.`,
    gotThenAsk: (g, l) => `${g} వచ్చింది. ఇప్పుడు ${l}?`,
    confirm: (s) => `సరే — ${s}. ఇప్పుడు మీ వాహన సమస్యను వివరించండి.`,
    thanks: 'ధన్యవాదాలు! మీ వివరాలు AI నిర్ధారణ కోసం పంపబడుతున్నాయి.',
    fields: {
      manufacturer: 'వాహన బ్రాండ్', model: 'మోడల్ పేరు', model_year: 'సంవత్సరం',
      fuel_type: 'ఇంధన రకం', transmission: 'ట్రాన్స్‌మిషన్',
    },
  },
  'mr-IN': {
    greeting: 'नमस्कार! कृपया तुमच्या गाडीबद्दल सांगा — ब्रँड, मॉडेल, वर्ष, इंधन आणि ट्रान्समिशन.',
    askField: (l) => `मला ${l} समजले नाही. कृपया पुन्हा सांगा.`,
    gotThenAsk: (g, l) => `${g} मिळाले. आता ${l}?`,
    confirm: (s) => `ठीक आहे — ${s}. आता तुमच्या गाडीची समस्या सांगा.`,
    thanks: 'धन्यवाद! तुमची माहिती AI निदानासाठी पाठवली जात आहे.',
    fields: {
      manufacturer: 'गाडीचा ब्रँड', model: 'मॉडेलचे नाव', model_year: 'वर्ष',
      fuel_type: 'इंधन प्रकार', transmission: 'ट्रान्समिशन',
    },
  },
};

/** Fall back to English prompts for languages without a translation yet. */
function promptsFor(code: string): Prompts {
  return PROMPTS[code] ?? PROMPTS['en-IN'];
}

@Component({
  selector: 'app-voice-mode',
  standalone: true,
  imports: [CommonModule, HttpClientModule],
  templateUrl: './voice-mode.component.html',
  styleUrls: ['./voice-mode.component.scss'],
})
export class VoiceModeComponent implements OnInit, OnDestroy {
  @Output() completed = new EventEmitter<VoiceSessionResult>();
  @Output() cancelled = new EventEmitter<void>();

  readonly voice = inject(VoiceDiagnosisService);
  private zone = inject(NgZone);
  private http = inject(HttpClient);

  step = signal<ConversationStep>('select-language');
  messages = signal<Message[]>([]);
  vehicleInfo = signal<Partial<ExtractedVehicleInfo>>({});
  problemDescription = signal('');
  detectedLanguage = signal('en-IN');

  readonly languages = VOICE_LANGUAGES;
  readonly isListening = computed(() => this.voice.state() === 'listening');
  readonly isSelectingLanguage = computed(() => this.step() === 'select-language');
  readonly aiMessage = computed(() => {
    const msgs = this.messages();
    const last = [...msgs].reverse().find(m => m.role === 'ai');
    return last?.text ?? '';
  });

  /** Captured vehicle fields, for the progress chips. */
  readonly capturedChips = computed(() => {
    const v = this.vehicleInfo() as any;
    const order = ['manufacturer', 'model', 'variant', 'model_year', 'fuel_type', 'transmission', 'odometer_km'];
    return order
      .filter(k => v[k])
      .map(k => ({
        key: k,
        value: k === 'odometer_km' ? `${Number(v[k]).toLocaleString()} km` : String(v[k]),
      }));
  });

  /** Prompts in the language the user picked. */
  private get p(): Prompts {
    return promptsFor(this.detectedLanguage());
  }

  ngOnInit() {
    // Open on the language picker — the user's choice drives the STT model,
    // so it must be set before any recognition starts.
    this.step.set('select-language');
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /** Called when the user picks a language from the dropdown. */
  chooseLanguage(lang: VoiceLanguage) {
    this.voice.selectLanguage(lang);   // sets recognition.lang + TTS voice
    this.detectedLanguage.set(lang.code);
    this.start();
  }

  start() {
    this.step.set('greeting');
    this.messages.set([]);
    this.vehicleInfo.set({});
    this.problemDescription.set('');
    this._aiSay(this.p.greeting, () => this._listenForVehicle());
  }

  cancel() {
    this.voice.stop();
    this.voice.stopSpeaking();
    this.cancelled.emit();
  }

  replayLast() {
    const msg = this.aiMessage();
    if (msg) this.voice.speak(msg);
  }

  // ── Conversation flow ────────────────────────────────────────────────────

  private _listenForVehicle() {
    this.step.set('capture-vehicle');
    // Language is already fixed by the user's pick — do not auto-detect and
    // override it, or a mis-transcription would switch the STT model mid-flow.
    this.voice.start((text) => {
      this.voice.stop();
      this._addMessage('user', text);
      this._extractAndMerge(text);
    });
  }

  private _extractAndMerge(text: string) {
    // Fast local pass first
    const clientInfo = extractVehicleInfo(text);

    if (clientInfo.missing.length === 0) {
      this._applyExtracted(clientInfo);
      return;
    }

    // Anything still missing → ask the backend Ollama extractor, which handles
    // free-form phrasing and native-script names the dictionaries don't cover.
    const apiBase = (environment as any).apiUrl ?? 'http://localhost:8000';
    this.http.post<any>(`${apiBase}/diagnosis/voice/extract`, { transcript: text })
      .subscribe({
        next: (backendInfo) => {
          // Backend wins for fields it resolved; client result fills the rest.
          this._applyExtracted({ ...clientInfo, ...(backendInfo ?? {}) });
        },
        error: () => this._applyExtracted(clientInfo), // offline → keep local result
      });
  }

  private _applyExtracted(info: any) {
    const before = this.vehicleInfo() as any;
    const merged = { ...before, ...info };
    delete merged.missing;

    // What this utterance actually added — used to acknowledge it out loud so
    // the user can tell a captured answer from an ignored one.
    const gained = Object.keys(merged)
      .filter(k => merged[k] && !before[k])
      .map(k => merged[k]);

    this.vehicleInfo.set(merged);

    // Compute missing from the fully accumulated info, not just this utterance
    const required = ['manufacturer', 'model', 'model_year', 'fuel_type', 'transmission'];
    const missing = required.filter(f => !merged[f]);

    if (missing.length > 0) {
      this._askMissingFields(missing, gained.join(', '));
    } else {
      this._confirmVehicle();
    }
  }

  /** Number of consecutive times we've asked for the same field. */
  private _fieldRetries = 0;
  private _lastAskedField = '';

  private _askMissingFields(missing: string[], gained = '') {
    const field = missing[0];

    // Track repeats so a field the speech engine keeps mangling doesn't trap
    // the user in a loop — after 2 tries, move on and let them fix it on the form.
    if (field === this._lastAskedField) {
      this._fieldRetries++;
    } else {
      this._lastAskedField = field;
      this._fieldRetries = 0;
    }

    if (this._fieldRetries >= 2) {
      const remaining = missing.slice(1);
      if (remaining.length > 0) {
        this._fieldRetries = 0;
        this._lastAskedField = '';
        this._askMissingFields(remaining);
      } else {
        this._confirmVehicle(); // give up on the rest; form is pre-filled
      }
      return;
    }

    const label = this.p.fields[field] ?? field;
    // Acknowledge what was just captured, so a successful answer never reads
    // as "I didn't catch that".
    const prompt = gained
      ? this.p.gotThenAsk(gained, label)
      : this.p.askField(label);

    this._aiSay(prompt, () => {
      this.step.set('capture-vehicle');
      this.voice.start((text) => {
        this.voice.stop();
        this._addMessage('user', text);
        this._extractAndMerge(text);
      });
    });
  }

  private _confirmVehicle() {
    this.step.set('confirm-vehicle');
    const v = this.vehicleInfo() as any;
    const summary = [
      v.manufacturer, v.model, v.variant, v.model_year,
      v.fuel_type, v.transmission,
      v.odometer_km ? `${v.odometer_km.toLocaleString()} km` : null,
    ].filter(Boolean).join(', ');

    this._aiSay(this.p.confirm(summary), () => this._listenForProblem());
  }

  private _listenForProblem() {
    this.step.set('capture-problem');
    this.voice.start((text) => {
      this.voice.stop();
      this._addMessage('user', text);
      this.problemDescription.set(text.trim());
      this._finish();
    });
  }

  private _finish() {
    this.step.set('done');
    this._aiSay(this.p.thanks, () => {
      this.completed.emit({
        vehicleInfo: this.vehicleInfo(),
        problemDescription: this.problemDescription(),
        detectedLanguage: this.detectedLanguage(),
      });
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private _aiSay(text: string, then?: () => void) {
    this._addMessage('ai', text);
    this.voice.speak(text);
    if (!then) return;

    let called = false;
    const done = () => {
      if (called) return;
      called = true;
      this.zone.run(() => then());
    };

    // Give TTS 600ms to start (fire onstart and set speakingState → 'speaking')
    // then poll until it finishes. Without this delay the interval sees 'idle'
    // before TTS has started and fires immediately.
    setTimeout(() => {
      if (this.voice.speakingState() === 'idle') {
        // TTS is muted or not supported — proceed right away
        done();
        return;
      }
      const check = setInterval(() => {
        if (this.voice.speakingState() === 'idle') {
          clearInterval(check);
          done();
        }
      }, 300);
      // Hard fallback: 12s max
      setTimeout(() => { clearInterval(check); done(); }, 12000);
    }, 600);
  }

  private _addMessage(role: 'ai' | 'user', text: string) {
    this.messages.update(msgs => [...msgs, { role, text }]);
  }

  ngOnDestroy() {
    this.voice.stop();
    this.voice.stopSpeaking();
  }
}
