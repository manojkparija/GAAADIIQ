/**
 * Moving a test drive along, and recording whether it sold.
 *
 * Before this, the dealer dashboard rendered `status` as text with no control
 * beside it, and the table had no UPDATE policy at all — so every request sat
 * on "Pending" for as long as it existed. The reported screenshot showed rows
 * 38 days old still pending.
 *
 * The rules worth pinning are the ones that keep the two fields honest: an
 * outcome only belongs to a drive that happened, and a refused write must not
 * look like a successful one. Supabase row-level security refuses by returning
 * zero rows rather than by raising, which is exactly the shape of failure that
 * gets mistaken for success.
 */
import { TestBed } from '@angular/core/testing';

import { TestDriveService, TestDriveRequest } from './test-drive.service';
import { SupabaseService } from './supabase.service';

/** Captures what would have been sent, and replays a canned response. */
class FakeSupabase {
  lastPatch: Record<string, unknown> | null = null;
  reply: { data: unknown[] | null; error: unknown } = { data: [{ id: 1 }], error: null };

  client = {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        this.lastPatch = patch;
        return {
          eq: () => ({ select: async () => this.reply }),
        };
      },
    }),
  };
}

describe('TestDriveService — status and outcome', () => {
  let svc: TestDriveService;
  let sb: FakeSupabase;

  const row = (over: Partial<TestDriveRequest> = {}): TestDriveRequest => ({
    id: 1, car_id: 'c1', car_make: 'Tata', car_model: 'Nexon', car_year: 2025,
    buyer_name: 'MKP', buyer_phone: '9903411202',
    preferred_date: '2026-07-30', preferred_time: '3:00 PM',
    status: 'Pending', ...over,
  });

  beforeEach(() => {
    sb = new FakeSupabase();
    TestBed.configureTestingModule({
      providers: [TestDriveService, { provide: SupabaseService, useValue: sb }],
    });
    svc = TestBed.inject(TestDriveService);
    svc.requests.set([row()]);
  });

  it('writes the new status through', async () => {
    await svc.update(1, { status: 'Confirmed' });
    expect(sb.lastPatch!['status']).toBe('Confirmed');
  });

  it('stamps completed_at when the drive is marked Completed', async () => {
    await svc.update(1, { status: 'Completed' });
    expect(sb.lastPatch!['completed_at']).toBeTruthy();
  });

  it('does not stamp completed_at for any other status', async () => {
    await svc.update(1, { status: 'Cancelled' });
    expect(sb.lastPatch!['completed_at']).toBeUndefined();
  });

  it('clears a recorded deal if the drive stops being Completed', async () => {
    // A "Won" hanging off a cancelled appointment would count towards the
    // conversion rate for a drive that never happened.
    await svc.update(1, { status: 'Cancelled' });
    expect(sb.lastPatch!['outcome']).toBeNull();
  });

  it('leaves the outcome alone when only the outcome is being set', async () => {
    await svc.update(1, { outcome: 'Won' });
    expect(sb.lastPatch!['outcome']).toBe('Won');
  });

  it('reports failure when row-level security refuses the write', async () => {
    // No error, no rows — the shape that looks like success.
    sb.reply = { data: [], error: null };
    await expectAsync(svc.update(1, { status: 'Completed' })).toBeResolvedTo(false);
  });

  it('leaves the local row untouched when the write is refused', async () => {
    sb.reply = { data: [], error: null };
    await svc.update(1, { status: 'Completed' });
    expect(svc.requests()[0].status).toBe('Pending');
  });

  it('reports failure on an error too', async () => {
    sb.reply = { data: null, error: { message: 'nope' } };
    await expectAsync(svc.update(1, { status: 'Completed' })).toBeResolvedTo(false);
  });

  it('merges the saved row back into the list on success', async () => {
    sb.reply = { data: [{ id: 1, status: 'Completed', outcome: 'Won' }], error: null };
    await svc.update(1, { status: 'Completed' });
    expect(svc.requests()[0].status).toBe('Completed');
    expect(svc.requests()[0].outcome).toBe('Won');
  });
});
