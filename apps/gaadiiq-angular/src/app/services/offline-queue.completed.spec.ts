/**
 * A queued request's response reaches whoever queued it.
 *
 * drainQueue() used to post the request and drop what came back — the comment
 * read "Success — don't re-add". For a diagnosis submitted in a tunnel that
 * meant the report was computed, billed and stored, and never shown: findable
 * in Past Diagnoses if the driver happened to be signed in, and findable
 * nowhere at all if they were not.
 *
 * The response is the point of the request, so the queue now hands it on and
 * the caller decides what to do with it. Additive — nothing that already used
 * this service has to subscribe.
 */
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';

import { OfflineQueueService, QueuedResult } from './offline-queue.service';

const ANALYSE = 'https://api.test/diagnosis/analyse';

function mount() {
  localStorage.clear();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return {
    svc: TestBed.inject(OfflineQueueService),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('OfflineQueueService — handing back what the server said', () => {
  afterEach(() => localStorage.clear());

  it('emits the response when a queued request finally succeeds', async () => {
    const { svc, http } = mount();
    const seen: QueuedResult[] = [];
    svc.completed.subscribe(r => seen.push(r));
    svc.enqueue(ANALYSE, 'POST', { model: 'Swift' });

    const drain = svc.drainQueue();
    http.expectOne(ANALYSE).flush({ preliminary_diagnosis: 'Brake squeal' });
    await drain;

    expect(seen.length).toBe(1);
    expect((seen[0].response as any).preliminary_diagnosis).toBe('Brake squeal');
  });

  it('says which request it was, so a listener can filter', async () => {
    // Several features share this queue; a diagnosis page must not react to a
    // lead submission.
    const { svc, http } = mount();
    const seen: QueuedResult[] = [];
    svc.completed.subscribe(r => seen.push(r));
    svc.enqueue(ANALYSE, 'POST', { model: 'Swift' });

    const drain = svc.drainQueue();
    http.expectOne(ANALYSE).flush({ preliminary_diagnosis: 'x' });
    await drain;

    expect(seen[0].url).toBe(ANALYSE);
  });

  it('does not emit for a request that failed', async () => {
    const { svc, http } = mount();
    const seen: QueuedResult[] = [];
    svc.completed.subscribe(r => seen.push(r));
    svc.enqueue(ANALYSE, 'POST', {});

    const drain = svc.drainQueue();
    http.expectOne(ANALYSE).flush(null, { status: 500, statusText: 'Server Error' });
    await drain;

    expect(seen).toEqual([]);
  });

  it('keeps the result for a page that was not mounted at the time', async () => {
    // The drain fires on the `online` event, which can arrive while the driver
    // is anywhere in the app. Losing it there is the same bug in a new place.
    const { svc, http } = mount();
    svc.enqueue(ANALYSE, 'POST', {});

    const drain = svc.drainQueue();
    http.expectOne(ANALYSE).flush({ preliminary_diagnosis: 'Brake squeal' });
    await drain;

    const taken = svc.takeLastCompleted('/diagnosis/analyse');
    expect((taken?.response as any).preliminary_diagnosis).toBe('Brake squeal');
  });

  it('hands the kept result over only once', async () => {
    // Otherwise every visit to the page reopens a report the driver has read.
    const { svc, http } = mount();
    svc.enqueue(ANALYSE, 'POST', {});
    const drain = svc.drainQueue();
    http.expectOne(ANALYSE).flush({ preliminary_diagnosis: 'x' });
    await drain;

    svc.takeLastCompleted('/diagnosis/analyse');

    expect(svc.takeLastCompleted('/diagnosis/analyse')).toBeNull();
  });

  it('does not hand a kept result to a different feature', async () => {
    const { svc, http } = mount();
    svc.enqueue('https://api.test/leads', 'POST', {});
    const drain = svc.drainQueue();
    http.expectOne('https://api.test/leads').flush({ ok: true });
    await drain;

    expect(svc.takeLastCompleted('/diagnosis/analyse')).toBeNull();
  });

  it('still drops a request after the attempt limit', async () => {
    // The existing contract, unchanged by any of this.
    const { svc, http } = mount();
    svc.enqueue(ANALYSE, 'POST', {});

    for (let i = 0; i < 5; i++) {
      const drain = svc.drainQueue();
      http.expectOne(ANALYSE).flush(null, { status: 500, statusText: 'Server Error' });
      await drain;
    }

    expect(svc.pendingCount).toBe(0);
  });
});
