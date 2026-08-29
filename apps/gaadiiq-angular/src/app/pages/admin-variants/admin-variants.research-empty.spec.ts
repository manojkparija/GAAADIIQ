/**
 * An empty answer from AI drafting must not be reported as a fact about the car.
 *
 * Reported: "Draft trims with AI" did nothing and the screen said
 *
 *     Nothing new found. Trims already recorded are left alone.
 *
 * Three situations produce an empty list — drafting switched off, the call to
 * the provider failing, and the model genuinely having nothing to add — and
 * that one sentence claimed the third, which nobody had checked.
 *
 * The research endpoint keeps answering 200 with an empty list when drafting
 * is off: a shortcut that cannot run must leave the manual form working
 * (test_research_being_unavailable_is_not_an_error holds that decision). So
 * the switched-off case is recovered from a separate availability call, and
 * the remaining ambiguity — empty versus failed — is stated rather than
 * guessed at.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { AdminVariantsComponent } from './admin-variants.component';

/** Answers by URL fragment, so the two calls can differ. */
function stubFetch(routes: Array<[string, unknown, number?]>) {
  const seen: string[] = [];
  window.fetch = ((url: any) => {
    const u = String(url);
    seen.push(u);
    for (const [fragment, body, status] of routes) {
      if (u.includes(fragment)) {
        return Promise.resolve(new Response(JSON.stringify(body), {
          status: status ?? 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
    }
    return Promise.resolve(new Response('[]', {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
  }) as typeof fetch;
  return seen;
}

describe('AdminVariantsComponent — AI drafting that returns nothing', () => {
  let c: any;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = window.fetch;
    TestBed.configureTestingModule({
      imports: [AdminVariantsComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    c = TestBed.createComponent(AdminVariantsComponent).componentInstance;
    c.selectedCarId.set('11111111-1111-4111-8111-111111111111');
    // authHeaders() reaches Supabase for a token; the stub ignores headers.
    c.authHeaders = async () => ({});
  });

  afterEach(() => { window.fetch = originalFetch; });

  it('names the switched-off case instead of calling it "nothing found"', async () => {
    const reason = 'AI drafting is switched off: no GEMINI_API_KEY is configured.';
    stubFetch([
      ['research-availability', { available: false, reason }],
      ['/variants/research', []],
    ]);

    await c.research();

    expect(c.error()).toBe(reason);
    expect(c.toastMsg()).not.toContain('nothing');
  });

  it('does not claim the car has no other trims when drafting is on', async () => {
    stubFetch([
      ['research-availability', { available: true, reason: null }],
      ['/variants/research', []],
    ]);

    await c.research();

    expect(c.error()).toBe('');
    // The remaining two outcomes cannot be told apart from here, so the
    // message must say that rather than assert the friendlier one.
    expect(c.toastMsg()).toContain('the call itself failed');
    expect(c.toastMsg()).toContain('Variant research failed');
  });

  it('asks about availability only when the answer was empty', async () => {
    const seen = stubFetch([
      ['research-availability', { available: true }],
      ['/variants/research', [{ id: 'v1', name: 'Delta' }]],
    ]);

    await c.research();

    expect(c.toastMsg()).toContain('1 trim(s) drafted');
    expect(seen.some(u => u.includes('research-availability')))
      .withContext('a successful draft has nothing ambiguous to explain')
      .toBe(false);
  });

  it('falls back to a plain message when the reason is missing', async () => {
    // An older API build, or a reason that came back null.
    stubFetch([
      ['research-availability', { available: false }],
      ['/variants/research', []],
    ]);

    await c.research();

    expect(c.error()).toContain('switched off');
  });

  it('keeps the mild message when the availability call itself fails', async () => {
    // It is a second opinion about a call that already succeeded. Reporting
    // its failure would replace a mild message with a confusing one.
    stubFetch([
      ['research-availability', { detail: 'nope' }, 500],
      ['/variants/research', []],
    ]);

    await c.research();

    expect(c.error()).toBe('');
    expect(c.toastMsg()).toContain('The AI returned no trims');
  });

  it('still reports an outright failure of the research call', async () => {
    stubFetch([['/variants/research', { detail: 'Car not found' }, 404]]);

    await c.research();

    expect(c.error()).toBe('Car not found');
  });
});
