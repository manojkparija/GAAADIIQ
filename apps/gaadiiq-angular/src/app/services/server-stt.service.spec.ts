/**
 * The Android capture path — MediaRecorder → POST /diagnosis/stt.
 *
 * This file did not exist. The server-STT service is the ONLY way the APK
 * hears anything (ServerSttService.browserSttUnusable() is true for every
 * Android WebView), and it had no tests at all, which is how the sixty-second
 * cap below went unnoticed.
 *
 * THE SIXTY-SECOND CAP
 *
 * start() armed `setTimeout(() => this.stopAndTranscribe('en-IN'), 60_000)`.
 * Two defects in one line:
 *
 *   1. The language was hardcoded. A Hindi or Tamil speaker who talked for the
 *      full minute had their clip transcribed as English.
 *   2. It called the service directly, bypassing
 *      voice-mode.finishRecording() — the only place the transcript callback
 *      is ever invoked. So the clip was uploaded, billed, transcribed, and
 *      then discarded. The conversation stalled with no error and no message.
 *
 * The cap itself has to stay: the server refuses audio over 60 seconds
 * (BR-IR-04), so a forgotten recording would be rejected outright.
 */
import { TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';

import { ServerSttService } from './server-stt.service';
import { environment } from '../../environments/environment';

/** A MediaRecorder that produces one chunk and stops when told. */
class FakeRecorder {
  static isTypeSupported = () => true;
  ondataavailable: ((e: any) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = 'audio/webm';
  constructor(_stream: any, _opts?: any) {}
  start() { /* capture begins */ }
  stop() {
    this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

/** navigator.mediaDevices is getter-only, so it has to be redefined. */
function fakeMediaDevices(getUserMedia: () => Promise<any>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia }, configurable: true, writable: true,
  });
}

function installFakes() {
  (window as any).MediaRecorder = FakeRecorder;
  fakeMediaDevices(() => Promise.resolve({ getTracks: () => [{ stop: () => {} }] }));
}

describe('ServerSttService — the sixty-second cap', () => {
  let svc: ServerSttService;
  let http: HttpTestingController;

  beforeEach(() => {
    installFakes();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    svc = TestBed.inject(ServerSttService);
    http = TestBed.inject(HttpTestingController);
  });

  it('hands the recording back to the caller rather than transcribing it alone', fakeAsync(() => {
    // The reported shape of the bug: the caller owns the conversation, so the
    // caller must be told. Without this the transcript goes nowhere.
    let handedBack = false;
    void svc.start(() => { handedBack = true; });
    tick();

    tick(60_000);

    expect(handedBack)
      .withContext('the 60s cap must route through the caller, not the service')
      .toBeTrue();
    discardPeriodicTasks();
  }));

  it('does not transcribe behind the caller\'s back', fakeAsync(() => {
    // The old line posted to /diagnosis/stt itself, in English, and threw the
    // answer away. Nothing should be uploaded without the caller asking.
    void svc.start(() => { /* caller will decide */ });
    tick();

    tick(60_000);

    http.expectNone(`${environment.apiUrl}/diagnosis/stt`);
    discardPeriodicTasks();
  }));

  it('leaves stopping to the caller it just called', fakeAsync(() => {
    // Deliberately NOT stopping here. stopAndTranscribe() is what produces the
    // clip, and it returns null if recording has already ended -- so a service
    // that stopped first would destroy the very transcript it just asked the
    // caller to fetch. The caller stops, immediately, in finishRecording().
    let handedBack = false;
    void svc.start(() => { handedBack = true; svc.cancel(); });
    tick();

    tick(60_000);

    expect(handedBack).toBeTrue();
    expect(svc.recording()).withContext('the caller stopped it').toBeFalse();
    discardPeriodicTasks();
  }));

  it('says something when the cap fires with no caller to hand back to', fakeAsync(() => {
    // Belt and braces: a caller that forgot the callback must still not get
    // silence. Transcribing in a language nobody chose is worse than saying so.
    void svc.start();
    tick();

    tick(60_000);

    expect(svc.errorMessage()).toContain('60 seconds');
    discardPeriodicTasks();
  }));

  it('does not fire the cap for a recording that ended normally', fakeAsync(() => {
    let handedBack = false;
    void svc.start(() => { handedBack = true; });
    tick();

    void svc.stopAndTranscribe('hi-IN');
    tick();
    http.expectOne(`${environment.apiUrl}/diagnosis/stt`)
      .flush({ text: 'ठीक है', language: 'hi-IN', provider: 'openai', confidence: null });
    tick(60_000);

    expect(handedBack).withContext('the timer must be cleared on a normal stop').toBeFalse();
    discardPeriodicTasks();
  }));
});

describe('ServerSttService — the language it transcribes in', () => {
  let svc: ServerSttService;
  let http: HttpTestingController;

  beforeEach(() => {
    installFakes();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    svc = TestBed.inject(ServerSttService);
    http = TestBed.inject(HttpTestingController);
  });

  it('sends the language it was given, not a default', fakeAsync(() => {
    void svc.start();
    tick();

    void svc.stopAndTranscribe('ta-IN');
    tick();

    const req = http.expectOne(`${environment.apiUrl}/diagnosis/stt`);
    expect(req.request.body.get('language')).toBe('ta-IN');
    req.flush({ text: 'சரி', language: 'ta-IN', provider: 'openai', confidence: null });
    discardPeriodicTasks();
  }));

  it('uploads the clip as a file part named speech.webm', fakeAsync(() => {
    // The server allow-lists on content type, and OpenAI reads the container
    // from the filename (services/stt.py). Both are decided here.
    void svc.start();
    tick();

    void svc.stopAndTranscribe('en-IN');
    tick();

    const req = http.expectOne(`${environment.apiUrl}/diagnosis/stt`);
    const file = req.request.body.get('file');
    expect(file.name).toBe('speech.webm');
    req.flush({ text: 'ok', language: 'en-IN', provider: 'openai', confidence: null });
    discardPeriodicTasks();
  }));
});

describe('ServerSttService — failures the user can act on', () => {
  let svc: ServerSttService;
  let http: HttpTestingController;

  beforeEach(() => {
    installFakes();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    svc = TestBed.inject(ServerSttService);
    http = TestBed.inject(HttpTestingController);
  });

  it('names a blocked microphone rather than failing silently', fakeAsync(() => {
    fakeMediaDevices(() => Promise.reject(new Error('NotAllowedError')));

    let ok: boolean | undefined;
    void svc.start().then(v => (ok = v));
    tick();

    expect(ok).toBeFalse();
    expect(svc.errorMessage()).toContain('Microphone');
    discardPeriodicTasks();
  }));

  it('reports a 503 as voice being unavailable, not as bad speech', fakeAsync(() => {
    // STT_PROVIDER unset on the server. Telling the user to speak more clearly
    // would blame them for a deployment setting.
    void svc.start();
    tick();
    void svc.stopAndTranscribe('en-IN');
    tick();

    http.expectOne(`${environment.apiUrl}/diagnosis/stt`)
      .flush({ detail: 'not configured' }, { status: 503, statusText: 'Service Unavailable' });
    tick();

    expect(svc.errorMessage()).toContain('unavailable');
    discardPeriodicTasks();
  }));

  it('clears a previous error when a new recording starts', fakeAsync(() => {
    svc.errorMessage.set('something old');

    void svc.start();
    tick();

    expect(svc.errorMessage()).toBe('');
    svc.cancel();          // clears the 60s cap timer too
    discardPeriodicTasks();
  }));
});
