/**
 * Server-side speech-to-text fallback (BR-VA-01).
 *
 * The Web Speech API is unavailable or unreliable in Android WebViews, Safari
 * and Firefox. Where it is missing, this records with MediaRecorder and posts
 * the clip to POST /diagnosis/stt. Browser STT stays primary wherever it works
 * — this never displaces it.
 */
import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ServerSttResult {
  text: string;
  language: string;
  provider: string;
  confidence: number | null;
}

/** Longest clip we will record, matching the server cap. */
const MAX_RECORDING_MS = 60_000;

@Injectable({ providedIn: 'root' })
export class ServerSttService {
  private http = inject(HttpClient);

  recording = signal(false);
  uploading = signal(false);
  errorMessage = signal('');
  /** Seconds elapsed in the current recording, for the UI countdown. */
  elapsed = signal(0);

  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private stopTimer: any = null;
  private tickTimer: any = null;

  readonly supported = typeof window !== 'undefined' &&
    typeof (window as any).MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia;

  /**
   * True when the browser cannot do speech recognition locally, so the server
   * path is required. Android WebView reports webkitSpeechRecognition on some
   * builds but never returns results, so the shell is treated as unsupported.
   */
  static browserSttUnusable(): boolean {
    if (typeof window === 'undefined') return true;
    const hasWebSpeech =
      'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
    if (!hasWebSpeech) return true;

    const ua = navigator.userAgent || '';
    const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.();
    // Android WebView: "wv" token, or Capacitor's own shell.
    const isAndroidWebView = /\bwv\b/.test(ua) || (isCapacitor && /Android/i.test(ua));
    return isAndroidWebView;
  }

  /** Pick a container the browser can actually produce. */
  private _mimeType(): string {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    for (const t of candidates) {
      if ((window as any).MediaRecorder?.isTypeSupported?.(t)) return t;
    }
    return '';
  }

  /**
   * Begin recording. Resolves once capture has actually started.
   *
   * `onMaxDuration` is called if the recording reaches the 60-second cap. The
   * caller must own what happens next: it knows which language was chosen and
   * which question the answer belongs to, and this service knows neither.
   *
   * It used to do the work itself — `stopAndTranscribe('en-IN')` — which
   * transcribed a Hindi speaker's clip as English AND resolved to nobody, so
   * the transcript was uploaded, billed and discarded while the conversation
   * sat waiting for an answer that had already arrived.
   */
  async start(onMaxDuration?: () => void): Promise<boolean> {
    if (!this.supported) {
      this.errorMessage.set('Audio recording is not supported in this browser.');
      return false;
    }
    this.errorMessage.set('');
    this.chunks = [];

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      this.errorMessage.set(
        'Microphone access is blocked. Enable the Microphone permission for GAADIIQ and try again.'
      );
      return false;
    }

    const mimeType = this._mimeType();
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
    this.recording.set(true);
    this.elapsed.set(0);

    this.tickTimer = setInterval(() => this.elapsed.update(s => s + 1), 1000);
    // Hard stop at the server's duration cap (BR-IR-04) so a forgotten
    // recording cannot produce a clip the API will reject.
    this.stopTimer = setTimeout(() => {
      if (onMaxDuration) {
        onMaxDuration();
        return;
      }
      // No caller to hand back to. Stop rather than transcribe in a language
      // nobody chose, and say so — a recording that just ends is
      // indistinguishable from one that never started.
      this.cancel();
      this.errorMessage.set(
        'That recording reached the 60 seconds limit. Please try again, more briefly.'
      );
    }, MAX_RECORDING_MS);
    return true;
  }

  /** Stop recording and transcribe. Returns null if nothing usable was captured. */
  async stopAndTranscribe(language: string): Promise<ServerSttResult | null> {
    if (!this.recorder || !this.recording()) return null;

    this._clearTimers();
    const recorder = this.recorder;
    const mimeType = recorder.mimeType || 'audio/webm';

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: mimeType }));
      recorder.stop();
    });

    this._releaseStream();
    this.recording.set(false);
    this.recorder = null;

    if (blob.size === 0) {
      this.errorMessage.set('No audio was captured. Please try again.');
      return null;
    }

    return this.transcribe(blob, language);
  }

  /** POST a recorded clip to the server transcription endpoint. */
  async transcribe(blob: Blob, language: string): Promise<ServerSttResult | null> {
    this.uploading.set(true);
    try {
      const form = new FormData();
      // Content type must be a bare mime — the server allowlist rejects
      // parameters it does not recognise on some browsers.
      form.append('file', blob, 'speech.webm');
      form.append('language', language);

      const result = await firstValueFrom(
        this.http.post<ServerSttResult>(`${environment.apiUrl}/diagnosis/stt`, form)
      );
      if (!result?.text) {
        this.errorMessage.set('No speech was recognised. Please try again.');
        return null;
      }
      return result;
    } catch (err: any) {
      // A 422 is the one status where the API's `detail` is written to be
      // read by the driver, and this used to throw it away and print "speak
      // clearly" over all of them alike — including the language the provider
      // could not recognise, which blamed them for a vendor limitation. Every
      // other status carries internal text ("not configured") and keeps the
      // fixed message.
      const detail = err?.status === 422 ? err?.error?.detail : '';
      this.errorMessage.set(detail || this._httpErrorMessage(err?.status));
      return null;
    } finally {
      this.uploading.set(false);
    }
  }

  private _httpErrorMessage(status?: number): string {
    switch (status) {
      case 503:
        return 'Voice input is unavailable on this device. Please type your answer instead.';
      case 413:
        return 'That recording was too long. Please keep it under 60 seconds.';
      case 415:
        return 'That audio format is not supported on this device.';
      case 422:
        return 'No speech was recognised. Please speak clearly and try again.';
      case 429:
        return 'Too many voice requests. Please wait a moment and try again.';
      default:
        return 'Could not reach the speech service. Check your connection and try again.';
    }
  }

  cancel() {
    this._clearTimers();
    if (this.recorder && this.recording()) {
      try { this.recorder.stop(); } catch { /* already stopped */ }
    }
    this._releaseStream();
    this.recorder = null;
    this.chunks = [];
    this.recording.set(false);
    this.elapsed.set(0);
  }

  private _clearTimers() {
    if (this.stopTimer) { clearTimeout(this.stopTimer); this.stopTimer = null; }
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
  }

  private _releaseStream() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }
}
