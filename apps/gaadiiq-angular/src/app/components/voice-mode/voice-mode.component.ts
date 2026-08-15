import {
  Component, Output, EventEmitter, signal, computed,
  OnDestroy, OnInit, inject, NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import {
  VoiceDiagnosisService, VOICE_LANGUAGES, VoiceLanguage,
  CONSENT_VERSION, VOICE_RETENTION_NOTICE,
} from '../../services/voice-diagnosis.service';
import { ServerSttService } from '../../services/server-stt.service';
import { extractVehicleInfo, ExtractedVehicleInfo } from '../../utils/vehicle-info-extractor';
import { environment } from '../../../environments/environment';

export interface VoiceSessionResult {
  vehicleInfo: Partial<ExtractedVehicleInfo>;
  problemDescription: string;
  detectedLanguage: string;
}

type ConversationStep =
  | 'consent'
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

const DRIVING_MODE_KEY = 'gq_voice_driving_mode';

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
  'kn-IN': {
    greeting: 'ನಮಸ್ಕಾರ! ದಯವಿಟ್ಟು ನಿಮ್ಮ ವಾಹನದ ಬಗ್ಗೆ ತಿಳಿಸಿ — ಬ್ರಾಂಡ್, ಮಾಡೆಲ್, ವರ್ಷ, ಇಂಧನ ಮತ್ತು ಟ್ರಾನ್ಸ್‌ಮಿಷನ್.',
    askField: (l) => `ನನಗೆ ${l} ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೊಮ್ಮೆ ಹೇಳಿ.`,
    gotThenAsk: (g, l) => `${g} ಸಿಕ್ಕಿತು. ಈಗ ${l}?`,
    confirm: (s) => `ಸರಿ — ${s}. ಈಗ ನಿಮ್ಮ ವಾಹನದ ಸಮಸ್ಯೆಯನ್ನು ವಿವರಿಸಿ.`,
    thanks: 'ಧನ್ಯವಾದಗಳು! ನಿಮ್ಮ ವಿವರಗಳನ್ನು AI ರೋಗನಿರ್ಣಯಕ್ಕೆ ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ.',
    fields: {
      manufacturer: 'ವಾಹನ ಬ್ರಾಂಡ್', model: 'ಮಾಡೆಲ್ ಹೆಸರು', model_year: 'ವರ್ಷ',
      fuel_type: 'ಇಂಧನ ಪ್ರಕಾರ', transmission: 'ಟ್ರಾನ್ಸ್‌ಮಿಷನ್',
    },
  },
  'ml-IN': {
    greeting: 'നമസ്കാരം! ദയവായി നിങ്ങളുടെ വാഹനത്തെക്കുറിച്ച് പറയൂ — ബ്രാൻഡ്, മോഡൽ, വർഷം, ഇന്ധനം, ട്രാൻസ്മിഷൻ.',
    askField: (l) => `എനിക്ക് ${l} മനസ്സിലായില്ല. ദയവായി വീണ്ടും പറയൂ.`,
    gotThenAsk: (g, l) => `${g} കിട്ടി. ഇനി ${l}?`,
    confirm: (s) => `ശരി — ${s}. ഇനി നിങ്ങളുടെ വാഹനത്തിന്റെ പ്രശ്നം വിവരിക്കൂ.`,
    thanks: 'നന്ദി! നിങ്ങളുടെ വിവരങ്ങൾ AI രോഗനിർണയത്തിനായി അയയ്ക്കുന്നു.',
    fields: {
      manufacturer: 'വാഹന ബ്രാൻഡ്', model: 'മോഡൽ പേര്', model_year: 'വർഷം',
      fuel_type: 'ഇന്ധന തരം', transmission: 'ട്രാൻസ്മിഷൻ',
    },
  },
  'gu-IN': {
    greeting: 'નમસ્તે! કૃપા કરીને તમારા વાહન વિશે જણાવો — બ્રાન્ડ, મોડેલ, વર્ષ, ઈંધણ અને ટ્રાન્સમિશન.',
    askField: (l) => `મને ${l} સમજાયું નહીં. કૃપા કરીને ફરીથી કહો.`,
    gotThenAsk: (g, l) => `${g} મળ્યું. હવે ${l}?`,
    confirm: (s) => `બરાબર — ${s}. હવે તમારા વાહનની સમસ્યા જણાવો.`,
    thanks: 'આભાર! તમારી વિગતો AI નિદાન માટે મોકલવામાં આવી રહી છે.',
    fields: {
      manufacturer: 'વાહન બ્રાન્ડ', model: 'મોડેલનું નામ', model_year: 'વર્ષ',
      fuel_type: 'ઈંધણ પ્રકાર', transmission: 'ટ્રાન્સમિશન',
    },
  },
  'pa-IN': {
    greeting: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਕਿਰਪਾ ਕਰਕੇ ਆਪਣੀ ਗੱਡੀ ਬਾਰੇ ਦੱਸੋ — ਬ੍ਰਾਂਡ, ਮਾਡਲ, ਸਾਲ, ਬਾਲਣ ਅਤੇ ਟ੍ਰਾਂਸਮਿਸ਼ਨ।',
    askField: (l) => `ਮੈਨੂੰ ${l} ਸਮਝ ਨਹੀਂ ਆਇਆ। ਕਿਰਪਾ ਕਰਕੇ ਦੁਬਾਰਾ ਦੱਸੋ।`,
    gotThenAsk: (g, l) => `${g} ਮਿਲ ਗਿਆ। ਹੁਣ ${l}?`,
    confirm: (s) => `ਠੀਕ ਹੈ — ${s}। ਹੁਣ ਆਪਣੀ ਗੱਡੀ ਦੀ ਸਮੱਸਿਆ ਦੱਸੋ।`,
    thanks: 'ਧੰਨਵਾਦ! ਤੁਹਾਡੀ ਜਾਣਕਾਰੀ AI ਨਿਦਾਨ ਲਈ ਭੇਜੀ ਜਾ ਰਹੀ ਹੈ।',
    fields: {
      manufacturer: 'ਗੱਡੀ ਦਾ ਬ੍ਰਾਂਡ', model: 'ਮਾਡਲ ਦਾ ਨਾਮ', model_year: 'ਸਾਲ',
      fuel_type: 'ਬਾਲਣ ਕਿਸਮ', transmission: 'ਟ੍ਰਾਂਸਮਿਸ਼ਨ',
    },
  },
  'or-IN': {
    greeting: 'ନମସ୍କାର! ଦୟାକରି ଆପଣଙ୍କ ଗାଡ଼ି ବିଷୟରେ କୁହନ୍ତୁ — ବ୍ରାଣ୍ଡ, ମଡେଲ, ବର୍ଷ, ଇନ୍ଧନ ଏବଂ ଟ୍ରାନ୍ସମିଶନ।',
    askField: (l) => `ମୁଁ ${l} ବୁଝିପାରିଲି ନାହିଁ। ଦୟାକରି ପୁନର୍ବାର କୁହନ୍ତୁ।`,
    gotThenAsk: (g, l) => `${g} ମିଳିଲା। ବର୍ତ୍ତମାନ ${l}?`,
    confirm: (s) => `ଠିକ ଅଛି — ${s}। ବର୍ତ୍ତମାନ ଆପଣଙ୍କ ଗାଡ଼ିର ସମସ୍ୟା କୁହନ୍ତୁ।`,
    thanks: 'ଧନ୍ୟବାଦ! ଆପଣଙ୍କ ବିବରଣୀ AI ନିଦାନ ପାଇଁ ପଠାଯାଉଛି।',
    fields: {
      manufacturer: 'ଗାଡ଼ି ବ୍ରାଣ୍ଡ', model: 'ମଡେଲ ନାମ', model_year: 'ବର୍ଷ',
      fuel_type: 'ଇନ୍ଧନ ପ୍ରକାର', transmission: 'ଟ୍ରାନ୍ସମିଶନ',
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
  readonly serverStt = inject(ServerSttService);
  private zone = inject(NgZone);
  private http = inject(HttpClient);

  readonly retentionNotice = VOICE_RETENTION_NOTICE;
  readonly consentVersion = CONSENT_VERSION;

  /**
   * True when the browser cannot transcribe locally, so capture goes through
   * MediaRecorder → POST /diagnosis/stt instead of the Web Speech API.
   */
  readonly useServerStt = ServerSttService.browserSttUnusable();

  step = signal<ConversationStep>('select-language');
  messages = signal<Message[]>([]);
  vehicleInfo = signal<Partial<ExtractedVehicleInfo>>({});
  problemDescription = signal('');
  detectedLanguage = signal('en-IN');

  readonly languages = VOICE_LANGUAGES;
  readonly isListening = computed(() => this.voice.state() === 'listening');

  /** Capturing on whichever engine this client uses. */
  readonly isCapturing = computed(() =>
    this.useServerStt ? this.serverStt.recording() : this.voice.state() === 'listening'
  );

  readonly captureStatus = computed(() => {
    if (this.serverStt.uploading()) return 'Transcribing…';
    if (this.isCapturing()) return this.useServerStt ? 'Recording…' : 'Listening…';
    if (this.voice.speakingState() === 'speaking') return 'Speaking…';
    return 'Tap mic to speak';
  });
  readonly isSelectingLanguage = computed(() => this.step() === 'select-language');
  readonly isAskingConsent = computed(() => this.step() === 'consent');
  /** True while a pre-conversation screen (consent / language) is showing. */
  readonly isSetup = computed(() => this.isAskingConsent() || this.isSelectingLanguage());
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

  /** True when the language is being inferred from speech rather than picked. */
  autoDetect = false;

  // ── Driving mode (BR-VA-08, BR-VA-09) ─────────────────────────────────────
  //
  // For a driver the screen is a distraction, not an interface. Driving mode
  // enlarges every target to a glanceable size, hides the transcript, and
  // keeps the conversation moving without taps: after the report is spoken it
  // offers to continue by voice rather than waiting for a button.

  drivingMode = signal(false);

  toggleDrivingMode() {
    const next = !this.drivingMode();
    this.drivingMode.set(next);
    try {
      localStorage.setItem(DRIVING_MODE_KEY, String(next));
    } catch { /* private mode */ }

    // Announce the change — the point of the mode is not looking at the screen.
    this.voice.speak(
      next
        ? 'Driving mode on. I will keep listening and read everything aloud.'
        : 'Driving mode off.'
    );
  }

  private _restoreDrivingMode() {
    try {
      this.drivingMode.set(localStorage.getItem(DRIVING_MODE_KEY) === 'true');
    } catch { /* private mode */ }
  }

  /** Prompts in the language the user picked. */
  private get p(): Prompts {
    return promptsFor(this.detectedLanguage());
  }

  ngOnInit() {
    this._restoreDrivingMode();
    // Consent must be recorded before any capture (TC-F-19); once granted it
    // persists, so returning users go straight to the language picker.
    this.step.set(this.voice.hasConsent() ? 'select-language' : 'consent');
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * User accepted the consent notice. In-app consent and OS permission are
   * separate gates — record the decision, then request the platform
   * permission and surface a failure explicitly rather than proceeding into
   * a capture that cannot work (BR-AND-01).
   */
  async grantConsent() {
    this.voice.recordConsent(true);
    const ok = await this.voice.ensureMicPermission();
    if (!ok) return;  // error message + settings guidance already shown
    this.step.set('select-language');
  }

  /** Retry after the user has changed the permission in OS/browser settings. */
  async retryPermission() {
    this.voice.dismissError();
    this.voice.permissionDenied.set(false);
    const ok = await this.voice.ensureMicPermission();
    if (ok) this.step.set('select-language');
  }

  /** User declined — close the overlay without capturing anything. */
  declineConsent() {
    this.voice.recordConsent(false);
    this.cancelled.emit();
  }

  /** Called when the user picks a language from the dropdown. */
  chooseLanguage(lang: VoiceLanguage) {
    this.autoDetect = false;
    this.voice.selectLanguage(lang);   // sets recognition.lang + TTS voice
    this.detectedLanguage.set(lang.code);
    this.start();
  }

  /**
   * Skip the picker and infer the language from what the user says (TC-F-15).
   * Recognition starts on en-IN, which transcribes Indian-language speech
   * poorly but well enough for script/keyword detection; once a language is
   * identified the flow restarts on the correct STT model.
   */
  useAutoDetect() {
    this.autoDetect = true;
    this.voice.selectLanguage(VOICE_LANGUAGES[0]);
    this.detectedLanguage.set('en-IN');
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
    this._stopListening();
    this.voice.stopSpeaking();
    this.cancelled.emit();
  }

  replayLast() {
    const msg = this.aiMessage();
    if (msg) this.voice.speak(msg);
  }

  // ── Capture abstraction (browser STT vs server STT) ───────────────────────

  /** Pending completion for a server-STT recording, resolved by finishRecording(). */
  private _sttCallback: ((text: string) => void) | null = null;

  /**
   * Capture one utterance, using whichever engine this client supports.
   *
   * Browser STT ends on its own silence detection. MediaRecorder has no VAD,
   * so the server path is user-terminated — the UI shows a Stop control while
   * `serverStt.recording()` is true.
   */
  /** The handler for the utterance we are currently waiting on.
   *
   * Kept so `tapMic()` can re-arm the same step of the conversation. Without
   * it, a driver whose capture ended early had no way back in: the status label
   * said "Tap mic to speak" and the mic was a decorative div. */
  private _lastOnResult: ((text: string) => void) | null = null;

  private _listen(onResult: (text: string) => void) {
    this._lastOnResult = onResult;
    // Never listen over ourselves. If any speech is still playing, the mic
    // hears it through the speaker — loudest on a phone with the speaker on,
    // which is exactly how this feature is used from a roadside.
    if (this.voice.speakingState() !== 'idle') this.voice.stopSpeaking();
    if (!this.useServerStt) {
      this.voice.start(onResult);
      return;
    }
    this._sttCallback = onResult;
    void this.serverStt.start().then((ok) => {
      if (!ok) {
        this.zone.run(() => this._sttCallback = null);
      }
    });
  }

  /**
   * Start listening again, from the mic the status label tells people to tap.
   *
   * The label read "Tap mic to speak" long before anything was tappable — the
   * mic was an aria-hidden div with no handler, so a session that stopped
   * capturing was a dead end with instructions. This re-arms the step the
   * conversation is already on rather than restarting it, so nothing the driver
   * has already said is thrown away.
   */
  tapMic() {
    if (this.isCapturing() || this.voice.speakingState() === 'speaking') return;
    const again = this._lastOnResult;
    if (again) this._listen(again);
  }

  /** Stop the server-STT recording, transcribe it, and resume the conversation. */
  async finishRecording() {
    const cb = this._sttCallback;
    this._sttCallback = null;
    const result = await this.serverStt.stopAndTranscribe(this.detectedLanguage());
    if (result?.text && cb) {
      this.zone.run(() => cb(result.text));
    }
  }

  private _stopListening() {
    if (this.useServerStt) {
      this.serverStt.cancel();
      this._sttCallback = null;
    } else {
      this.voice.stop();
    }
  }

  // ── Conversation flow ────────────────────────────────────────────────────

  private _listenForVehicle() {
    this.step.set('capture-vehicle');
    this._listen((text) => {
      this._stopListening();
      this._addMessage('user', text);

      // In auto-detect mode the first utterance decides the language; after
      // that it is fixed, so a later mis-transcription can't switch models
      // mid-conversation. When the user picked explicitly, never override.
      if (this.autoDetect) {
        this.autoDetect = false;
        const lang = this.voice.autoDetectLanguage(text);
        if (lang.code !== this.detectedLanguage()) {
          this.detectedLanguage.set(lang.code);
          // Re-ask in the detected language: the first pass ran on the wrong
          // STT model, so its transcript is not worth extracting from.
          this._aiSay(this.p.greeting, () => this._listenForVehicle());
          return;
        }
      }

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

  /**
   * Merge newly extracted fields over what we already know.
   *
   * Spreading would be wrong. `{ ...before, ...info }` lets a key that is
   * PRESENT and `undefined` overwrite a value we already captured — and that is
   * exactly what happened to the model year. `extractVehicleInfo` assigns
   * `result.model_year` unconditionally, so a later utterance about fuel type
   * carries `model_year: undefined` and wiped the year the driver had already
   * given, which made the assistant ask for it a second time.
   *
   * That is also why only the year and the odometer were affected: every other
   * field is assigned inside an `if (matched)` and is simply absent when it
   * does not match, so spreading never clobbered it.
   *
   * A slot-filling conversation only ever accumulates. Nothing a later
   * utterance says should erase an earlier answer.
   */
  private _mergeKnown(before: any, info: any): any {
    const merged = { ...before };
    for (const [key, value] of Object.entries(info ?? {})) {
      if (value !== undefined && value !== null && value !== '') merged[key] = value;
    }
    return merged;
  }

  private _applyExtracted(info: any) {
    const before = this.vehicleInfo() as any;
    const merged = this._mergeKnown(before, info);
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
      this._listen((text) => {
        this._stopListening();
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
    this._listen((text) => {
      this._stopListening();
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

      // Hard fallback, and the reason it is 4s rather than 12s.
      //
      // Chrome's speechSynthesis does not reliably fire `onend` — it stalls on
      // longer utterances, and on Android it can go silent after a tab regains
      // focus. When that happened, speakingState stayed 'speaking' and the
      // microphone stayed shut for the full twelve seconds while the user
      // stared at a mic that never opened. That is the "mic never goes into
      // listening mode" report.
      //
      // 4s is longer than any prompt this component speaks and short enough
      // that a stall is a hesitation rather than a hang. `stopSpeaking()`
      // before `done()` matters just as much: opening the microphone while the
      // assistant is still audible means the recogniser transcribes the app's
      // own question as the user's answer, which is the other half of "it
      // isn't capturing the car details properly".
      setTimeout(() => {
        clearInterval(check);
        this.voice.stopSpeaking();
        done();
      }, 4000);
    }, 600);
  }

  private _addMessage(role: 'ai' | 'user', text: string) {
    this.messages.update(msgs => [...msgs, { role, text }]);
  }

  ngOnDestroy() {
    // Release the mic on both paths — a live MediaRecorder stream would keep
    // the OS recording indicator on after the overlay closes.
    this.voice.stop();
    this.serverStt.cancel();
    this.voice.stopSpeaking();
  }
}
