/**
 * Server-side speech output (BR-API-02) — the fallback that makes the spoken
 * report dependable on a phone we do not control.
 *
 * WHY THIS EXISTS
 *
 * The device engine is the primary path: free, instant, offline. But it can
 * only speak languages the user happens to have voice data for, and Android
 * ships very little Indian-language voice data. Depending on it alone means
 * telling a Play Store user to go to Settings → Accessibility → Text-to-speech
 * and install a voice, which is a debugging step, not a product.
 *
 * So where the device cannot speak, the audio is synthesised on the server and
 * played here. The user never learns which path ran.
 *
 * Costs money per character, so it is a fallback and not the default: most
 * phones speak English for free and never reach this.
 *
 * A 503 means TTS_PROVIDER is unset on the server. That is not an error to
 * show anybody — it is the deployment simply not having the feature — so it
 * resolves false like any other failure and the caller moves on.
 */
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

interface TtsResponse {
  audio_base64: string;
  content_type: string;
  provider: string;
  voice: string;
  language: string;
}

/** Matches the server's cap (routers/diagnosis.py TtsRequest). */
const MAX_CHARS = 3000;

@Injectable({ providedIn: 'root' })
export class ServerTtsService {
  private http = inject(HttpClient);

  /** True while audio is being fetched or played. */
  speaking = signal(false);

  /** Why the last attempt failed, for whoever has to investigate. */
  lastError = '';

  private audio: HTMLAudioElement | null = null;
  private objectUrl = '';

  /**
   * Speak `text` through the server. Resolves true only if audio actually
   * played to the end — a resolved promise with no sound is the failure mode
   * this whole change exists to avoid.
   */
  async speak(text: string, language: string): Promise<boolean> {
    this.lastError = '';
    if (!text) return false;

    let body: TtsResponse;
    try {
      body = await firstValueFrom(
        this.http.post<TtsResponse>(`${environment.apiUrl}/diagnosis/tts`, {
          // The server rejects anything longer; a truncated report read aloud
          // beats a request refused outright.
          text: text.slice(0, MAX_CHARS),
          language,
        })
      );
    } catch (err: any) {
      // 503 is "TTS_PROVIDER is not configured" — expected, not alarming.
      this.lastError = err?.status === 503
        ? 'server speech is not configured'
        : `server speech failed (${err?.status ?? 'no response'})`;
      return false;
    }

    if (!body?.audio_base64) {
      this.lastError = 'server returned no audio';
      return false;
    }

    try {
      return await this._play(body.audio_base64, body.content_type || 'audio/mpeg');
    } catch (err: any) {
      this.lastError = err?.message || 'playback failed';
      return false;
    }
  }

  /** Stop any server audio. Safe when nothing is playing. */
  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }
    this._revoke();
    this.speaking.set(false);
  }

  private _play(base64: string, contentType: string): Promise<boolean> {
    this.stop();

    const blob = this._toBlob(base64, contentType);
    this.objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(this.objectUrl);
    this.audio = audio;

    return new Promise<boolean>((resolve) => {
      const done = (ok: boolean) => {
        this._revoke();
        this.speaking.set(false);
        this.audio = null;
        resolve(ok);
      };

      audio.onended = () => done(true);
      audio.onerror = () => {
        this.lastError = 'the phone could not play the audio';
        done(false);
      };

      this.speaking.set(true);
      // play() rejects when autoplay policy blocks it. Every call here is
      // downstream of a tap, so that should not happen — but it must not
      // resolve true if it does.
      audio.play().catch((err: any) => {
        this.lastError = err?.message || 'playback was blocked';
        done(false);
      });
    });
  }

  private _toBlob(base64: string, contentType: string): Blob {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: contentType });
  }

  private _revoke() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = '';
    }
  }
}
