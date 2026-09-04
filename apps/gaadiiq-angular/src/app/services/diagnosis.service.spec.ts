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
    expect(service.error()).toContain('HTTP 500');
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

  it('names a rate limit as a rate limit, not an outage', async () => {
    // 5/minute, 20/hour on the endpoint. Nothing is broken and the fix is to
    // wait — telling someone the service is unreachable sends them to look for
    // a problem that does not exist.
    const pending = service.analyse(REQUEST);
    http.expectOne(url).flush('slow down', { status: 429, statusText: 'Too Many Requests' });
    await pending;
    expect(service.error()).toContain('Too many diagnosis requests');
  });

  it('names a blocked request as blocked', async () => {
    const pending = service.analyse(REQUEST);
    http.expectOne(url).error(new ProgressEvent('network error'), { status: 0 });
    await pending;
    expect(service.error()).toContain('CORS');
  });

  it('does not mark a real API answer as an offline estimate', async () => {
    // `offline_fallback` is set by this client only. A server that happened to
    // echo the field must not make a real diagnosis look degraded.
    const pending = service.analyse(REQUEST);
    http.expectOne(url).flush({ ...SERVER_ANSWER, offline_fallback: false });
    const report = await pending;
    expect(report!.offline_fallback).toBeFalsy();
  });
});

/**
 * The AI Diagnosis gate: signed in to run one, and rationed by plan.
 *
 * The property worth pinning is narrow and easy to lose: a refusal must NOT
 * fall through to `clientFallback()`. Every other failure in this file ends
 * with the offline estimate on screen, and that is right for an outage — but
 * showing it here would hand over a diagnosis-shaped answer the server just
 * declined to give, which makes the gate decorative. The enforcement itself is
 * server-side (apps/api/tests/test_diagnosis_quota.py); this is about what the
 * page does with the "no".
 */
describe('DiagnosisService — sign-in and quota refusals', () => {
  let service: DiagnosisService;
  let http: HttpTestingController;
  const url = `${environment.apiUrl}/diagnosis/analyse`;
  const quotaUrl = `${environment.apiUrl}/diagnosis/quota`;

  const EXHAUSTED = {
    detail: {
      code: 'diagnosis_quota_exhausted',
      message: 'You have used all 3 AI Diagnosis runs included with Free this month.',
      plan: 'free',
      plan_label: 'Free',
      limit: 3,
      used: 3,
      remaining: 0,
      unlimited: false,
      allowed: false,
      period: '2026-09',
    },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DiagnosisService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DiagnosisService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows no report at all when the caller is not signed in', async () => {
    const pending = service.analyse(REQUEST);
    http.expectOne(url).flush(
      { detail: { code: 'sign_in_required', message: 'Sign in to run an AI diagnosis.' } },
      { status: 401, statusText: 'Unauthorized' },
    );
    const report = await pending;

    expect(report).toBeNull();
    expect(service.report()).toBeNull();
    expect(service.blocked()?.reason).toBe('sign_in_required');
    // The whole point: no canned diagnosis stood in for the refusal.
    expect(service.error()).toBeNull();
  });

  it('shows no report at all when the monthly allowance is spent', async () => {
    const pending = service.analyse(REQUEST);
    http.expectOne(url).flush(EXHAUSTED, { status: 403, statusText: 'Forbidden' });
    const report = await pending;

    expect(report).toBeNull();
    expect(service.report()).toBeNull();
    expect(service.blocked()?.reason).toBe('quota_exhausted');
    expect(service.error()).toBeNull();
  });

  it('carries the plan and counts through, so the page can name them', async () => {
    const pending = service.analyse(REQUEST);
    http.expectOne(url).flush(EXHAUSTED, { status: 403, statusText: 'Forbidden' });
    await pending;

    const q = service.blocked()!.quota!;
    expect(q.plan_label).toBe('Free');
    expect([q.used, q.limit, q.remaining]).toEqual([3, 3, 0]);
    // And the page's own banner is brought up to date by the same response,
    // rather than continuing to advertise runs that no longer exist.
    expect(service.quota()?.remaining).toBe(0);
  });

  it('still shows the offline estimate for a 500, which is an outage not a refusal', async () => {
    // The dividing line. Both are non-2xx; only one of them means "you may not".
    const pending = service.analyse(REQUEST);
    http.expectOne(url).flush('boom', { status: 500, statusText: 'Server Error' });
    const report = await pending;

    expect(report!.offline_fallback).toBeTrue();
    expect(service.blocked()).toBeNull();
  });

  it('does not read an ordinary 403 as an exhausted quota', async () => {
    // A 403 without the code is some other authorisation problem, and telling
    // that user to upgrade would point them at a purchase that fixes nothing.
    const pending = service.analyse(REQUEST);
    http.expectOne(url).flush({ detail: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });
    await pending;

    expect(service.blocked()).toBeNull();
    expect(service.error()).toContain('403');
  });

  it('clears a previous refusal when a later run succeeds', async () => {
    const first = service.analyse(REQUEST);
    http.expectOne(url).flush(EXHAUSTED, { status: 403, statusText: 'Forbidden' });
    await first;
    expect(service.blocked()).not.toBeNull();

    const second = service.analyse(REQUEST);
    http.expectOne(url).flush(SERVER_ANSWER);
    await second;
    expect(service.blocked()).toBeNull();
  });

  it('leaves the quota unknown rather than guessing when the status call fails', async () => {
    // A guessed default is worse than none: "free, 3 left" is a lie to a Buyer
    // Pro, and "unlimited" promises runs that will be refused.
    const pending = service.loadQuota();
    http.expectOne(quotaUrl).error(new ProgressEvent('network error'));
    expect(await pending).toBeNull();
    expect(service.quota()).toBeNull();
  });

  it('reads the allowance back for the page to render', async () => {
    const pending = service.loadQuota();
    http.expectOne(quotaUrl).flush({
      plan: 'seller_basic', plan_label: 'Seller Basic', limit: 10, used: 4,
      remaining: 6, unlimited: false, allowed: true, period: '2026-09', signed_in: true,
    });
    await pending;
    expect(service.quota()?.remaining).toBe(6);
    expect(service.quota()?.unlimited).toBeFalse();
  });
});
