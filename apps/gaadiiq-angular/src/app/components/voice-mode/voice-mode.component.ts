import {
  Component, Output, EventEmitter, signal, computed,
  OnDestroy, OnInit, inject, NgZone
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { VoiceDiagnosisService } from '../../services/voice-diagnosis.service';
import { extractVehicleInfo, ExtractedVehicleInfo } from '../../utils/vehicle-info-extractor';

export interface VoiceSessionResult {
  vehicleInfo: Partial<ExtractedVehicleInfo>;
  problemDescription: string;
  detectedLanguage: string;
}

type ConversationStep =
  | 'idle'
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

const FIELD_LABELS: Record<string, string> = {
  manufacturer: 'vehicle brand',
  model: 'model name',
  model_year: 'year of manufacture',
  fuel_type: 'fuel type (Petrol/Diesel/CNG/Electric)',
  transmission: 'transmission type (Manual/Automatic)',
};

@Component({
  selector: 'app-voice-mode',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './voice-mode.component.html',
  styleUrls: ['./voice-mode.component.scss'],
})
export class VoiceModeComponent implements OnInit, OnDestroy {
  @Output() completed = new EventEmitter<VoiceSessionResult>();
  @Output() cancelled = new EventEmitter<void>();

  readonly voice = inject(VoiceDiagnosisService);
  private zone = inject(NgZone);

  step = signal<ConversationStep>('idle');
  messages = signal<Message[]>([]);
  vehicleInfo = signal<Partial<ExtractedVehicleInfo>>({});
  problemDescription = signal('');
  detectedLanguage = signal('en-IN');

  readonly isListening = computed(() => this.voice.state() === 'listening');
  readonly isIdle = computed(() => this.step() === 'idle');
  readonly aiMessage = computed(() => {
    const msgs = this.messages();
    const last = [...msgs].reverse().find(m => m.role === 'ai');
    return last?.text ?? '';
  });

  ngOnInit() {
    // Auto-start immediately when the overlay mounts
    this.start();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  start() {
    this.step.set('greeting');
    this.messages.set([]);
    this.vehicleInfo.set({});
    this.problemDescription.set('');
    this._aiSay(
      'Hello! I\'m your voice diagnosis assistant. Please tell me about your vehicle — mention the brand, model, year, fuel type, and transmission.',
      () => this._listenForVehicle()
    );
  }

  cancel() {
    this.voice.stop();
    this.voice.stopSpeaking();
    this.step.set('idle');
    this.cancelled.emit();
  }

  replayLast() {
    const msg = this.aiMessage();
    if (msg) this.voice.speak(msg);
  }

  // ── Conversation flow ────────────────────────────────────────────────────

  private _listenForVehicle() {
    this.step.set('capture-vehicle');
    this.voice.start((text) => {
      this.voice.stop();
      const lang = this.voice.autoDetectLanguage(text);
      this.detectedLanguage.set(lang.code);
      this._addMessage('user', text);

      const info = extractVehicleInfo(text);
      const merged = { ...this.vehicleInfo(), ...info };
      // Remove missing array from spread
      delete (merged as any).missing;
      this.vehicleInfo.set(merged);

      if (info.missing.length > 0) {
        this._askMissingFields(info.missing);
      } else {
        this._confirmVehicle();
      }
    });
  }

  private _askMissingFields(missing: string[]) {
    const field = missing[0];
    const label = FIELD_LABELS[field] ?? field;
    const prompt = `I didn't catch the ${label}. Could you please tell me that?`;
    this._aiSay(prompt, () => {
      this.step.set('capture-vehicle');
      this.voice.start((text) => {
        this.voice.stop();
        this._addMessage('user', text);
        const patch = extractVehicleInfo(text);
        const merged = { ...this.vehicleInfo(), ...patch };
        delete (merged as any).missing;
        this.vehicleInfo.set(merged);

        const remaining = patch.missing.filter(f => !Object.keys(merged).includes(f));
        if (remaining.length > 0) {
          this._askMissingFields(remaining);
        } else {
          this._confirmVehicle();
        }
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

    const msg = `Got it! ${summary}. Now please describe the problem with your vehicle.`;
    this._aiSay(msg, () => this._listenForProblem());
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
    this._aiSay('Thank you! Sending your details for AI diagnosis now…', () => {
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
    if (then) {
      // Wait for speech to finish before listening (or 2s fallback)
      const check = setInterval(() => {
        if (this.voice.speakingState() === 'idle') {
          clearInterval(check);
          this.zone.run(() => then());
        }
      }, 300);
      // Safety fallback: advance after 8s
      setTimeout(() => { clearInterval(check); this.zone.run(() => then?.()); }, 8000);
    }
  }

  private _addMessage(role: 'ai' | 'user', text: string) {
    this.messages.update(msgs => [...msgs, { role, text }]);
  }

  ngOnDestroy() {
    this.voice.stop();
    this.voice.stopSpeaking();
  }
}
