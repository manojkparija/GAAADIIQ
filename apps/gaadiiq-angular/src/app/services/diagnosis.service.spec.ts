/**
 * DiagnosisService.analyse — which answer reaches the screen, and whether the
 * user can tell which one it is.
 *
 * The reported bug was "the response looks hardcoded". It was: `analyse` showed
 * `clientFallback()` — a table of about a dozen English strings — immediately,
 * cleared the loading flag, and fired the API call off with `.catch(() => {})`.
 * So the canned answer was always first, an outage was silent, and a Hindi
 * speaker got English no matter what the API would have said.
 *
 * These tests pin the three properties that follow from fixing it.
 */

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';

import { DiagnosisService, DiagnoseRequest, DiagnosisReport } from './diagnosis.service';
import { environment } from '../../environments/environment';

const REQUEST: DiagnoseRequest = {
  manufacturer: 'Maruti Suzuki',
  model: 'Swift',
  model_year: 2010,
  fuel_type: 'Petrol',
  transmission: 'Manual',
  problem_description: 'Braking system is not working properly',
  warning_lights: [],
  when_occurs: [],
  severity: 'high',
} as DiagnoseRequest;

const SERVER_ANSWER = {
  id: 'server-1',
  preliminary_diagnosis: 'ब्रेक पैड घिस गए हैं',
  possible_causes: [{ cause: 'घिसे हुए ब्रेक पैड', confidence: 80, explanation: 'सामान्य' }],
  repair_complexity: 'Moderate',
  cost_min_inr: 3000,
  cost_max_inr: 6000,
  repair_time_estimate: '2 hours',
  safe_to_drive: false,
  risk_level: 'High',
  recommended_steps: ['मैकेनिक से जांच कराएं'],
  diy_fixes: [],
  immediate_service_required: true,
  preventive_maintenance: [],
  retrieved_sources: [],
  ollama_used: false,
  analysis_confidence: 85,
  disclaimer: 'x',
  created_at: new Date().toISOString(),
} as unknown as DiagnosisReport;

describe('DiagnosisService.analyse', () => {
  let service: DiagnosisService;
  let http: HttpTestingController;
  const url = `${environment.apiUrl}/diagnosis/analyse`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DiagnosisService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DiagnosisService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('serves the API answer, in the language the API replied in', async () => {
    const pending = service.analyse(REQUEST);
    http.expectOne(url).flush(SERVER_ANSWER);
    const report = await pending;

    expect(report!.preliminary_diagnosis).toBe('ब्रेक पैड घिस गए हैं');
    expect(report!.offline_fallback).toBeFalsy();
    expect(service.error()).toBeNull();
  });

  it('never shows the built-in table while the API is still answering', fakeAsync(() => {
    // The heart of the bug. The canned English answer used to be on screen
    // before the request had even left the browser.
    service.analyse(REQUEST);
    tick();

    expect(service.report()).toBeNull();
    expect(service.loading()).toBe(true);

    http.expectOne(url).flush(SERVER_ANSWER);
    tick();

    expect(service.report()!.preliminary_diagnosis).toBe('ब्रेक पैड घिस गए हैं');
    expect(service.loading()).toBe(false);
  }));

  it('falls back when the API fails, and says that it did', async () => {
    const pending = service.analyse(REQUEST);
    http.expectOne(url).flush('boom', { status: 500, statusText: 'Server Error' });
    const report = await pending;

    // The fallback still answers — a driver at the roadside gets something.
    expect(report!.preliminary_diagnosis).toBeTruthy();
    // But it is labelled, so the page can say which one is on screen.
    expect(report!.offline_fallback).toBe(true);
    expect(service.error()).toContain('offline estimate');
    expect(service.loading()).toBe(false);
  });

  it('does not swallow a network failure', async () => {
    const pending = service.analyse(REQUEST);
    http.expectOne(url).error(new ProgressEvent('network error'));
    const report = await pending;

    expect(report!.offline_fallback).toBe(true);
    expect(service.error()).toBeTruthy();
  });

  it('treats an empty body as a failure rather than an answer', async () => {
    const pending = service.analyse(REQUEST);
    http.expectOne(url).flush(null);
    const report = await pending;

    expect(report!.offline_fallback).toBe(true);
  });

  it('clears the previous report before a new request', fakeAsync(() => {
    service.analyse(REQUEST);
    http.expectOne(url).flush(SERVER_ANSWER);
    tick();
    expect(service.report()).not.toBeNull();

    service.analyse(REQUEST);
    tick();
    // A stale answer on screen during a new request is how someone reads last
    // question's diagnosis as this one's.
    expect(service.report()).toBeNull();

    http.expectOne(url).flush(SERVER_ANSWER);
    tick();
  }));

  it('does not mark a real API answer as an offline estimate', async () => {
    // `offline_fallback` is set by this client only. A server that happened to
    // echo the field must not make a real diagnosis look degraded.
    const pending = service.analyse(REQUEST);
    http.expectOne(url).flush({ ...SERVER_ANSWER, offline_fallback: false });
    const report = await pending;
    expect(report!.offline_fallback).toBeFalsy();
  });
});
