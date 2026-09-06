/**
 * Who is handling a test drive, and when they picked it up.
 *
 * ASKED FOR DIRECTLY: "test drive enquiries needs to be handled by a sales
 * executive, his details needs to be captured here", annotated on the Test
 * Drives tab.
 *
 * A request carried a status and, once it happened, an outcome — but never a
 * record of who took it. With one person that is obvious; with three it is the
 * first question asked when a buyer rings back and nobody knows who promised
 * them what.
 *
 * The behaviour worth pinning is `assigned_at`. It answers "how long did this
 * sit before anybody picked it up", which is the number that says whether the
 * process works at all. That question is only answerable if the stamp is set
 * once and then left alone: a handover to a second executive on day three must
 * not make it look like the buyer was attended to on day three. Getting this
 * wrong produces a metric that is always flattering and always wrong, and
 * nothing about the screen would reveal it.
 */
import { TestBed } from '@angular/core/testing';
import { TestDriveService, TestDriveRequest } from './test-drive.service';
import { SupabaseService } from './supabase.service';

/** Captures the patch sent to Supabase, and echoes it back as the saved row. */
function captureUpdates(rows: TestDriveRequest[]) {
  const sent: Record<string, unknown>[] = [];
  const client = {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        sent.push(patch);
        return {
          eq: () => ({
            select: () => Promise.resolve({ data: [{ ...rows[0], ...patch }], error: null }),
          }),
        };
      },
      select: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }),
    }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  };
  return { sent, service: { client } };
}

function makeService(rows: TestDriveRequest[]) {
  const { sent, service } = captureUpdates(rows);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: SupabaseService, useValue: service }],
  });
  const svc = TestBed.inject(TestDriveService);
  svc.requests.set(rows);
  return { svc, sent };
}

const BASE: TestDriveRequest = {
  id: 1,
  car_id: 'c-1',
  car_make: 'Tata',
  car_model: 'Nexon EV',
  car_year: 2025,
  buyer_name: 'Asha',
  buyer_phone: '+919000000000',
  preferred_date: '2026-09-10',
  preferred_time: '10:00',
};

describe('TestDriveService — recording the sales executive', () => {
  it('stamps assigned_at the first time somebody takes it on', async () => {
    const { svc, sent } = makeService([{ ...BASE, assigned_at: null }]);

    await svc.update(1, { executive_name: 'Ravi', executive_phone: '+919111111111' });

    expect(sent[0]['executive_name']).toBe('Ravi');
    expect(sent[0]['assigned_at'])
      .withContext('without this, "how long was it unassigned" has no answer')
      .toBeTruthy();
  });

  it('does not restart the clock when it is handed to somebody else', async () => {
    // The one that matters. A reassignment on day three must not make the
    // record say the buyer was picked up on day three.
    const alreadyAssigned = '2026-09-01T09:00:00.000Z';
    const { svc, sent } = makeService([{ ...BASE, assigned_at: alreadyAssigned }]);

    await svc.update(1, { executive_name: 'Priya', executive_phone: '+919222222222' });

    expect(sent[0]['executive_name']).toBe('Priya');
    expect(sent[0]['assigned_at'])
      .withContext('reassignment must not rewrite when it was first picked up')
      .toBeUndefined();
  });

  it('does not stamp when the name is being cleared', async () => {
    // Unassigning is not an assignment. Stamping here would record a pickup
    // that did not happen.
    const { svc, sent } = makeService([{ ...BASE, assigned_at: null }]);

    await svc.update(1, { executive_name: null, executive_phone: null });

    expect(sent[0]['assigned_at']).toBeUndefined();
  });

  it('leaves status and outcome alone', async () => {
    // Assigning somebody is not progress on the appointment itself. The
    // update method clears `outcome` whenever status moves — this must not
    // trip that, or naming an executive would silently wipe a recorded deal.
    const { svc, sent } = makeService([
      { ...BASE, status: 'Completed', outcome: 'Won', assigned_at: null },
    ]);

    await svc.update(1, { executive_name: 'Ravi', executive_phone: '+919111111111' });

    expect(sent[0]['outcome'])
      .withContext('naming an executive must not wipe a recorded deal')
      .toBeUndefined();
    expect(sent[0]['status']).toBeUndefined();
  });
});
