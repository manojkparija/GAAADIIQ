/**
 * The admin queue for dealer-submitted photographs.
 *
 * From UAT: a dealer's upload must not be publicly visible until an admin
 * passes it. The gate is in the database — buyers read only
 * `status = 'approved'`, and a trigger refuses a status change from anyone who
 * is not an admin — so these tests cover the screen's behaviour, not the
 * enforcement. Deleting this service would not publish a single pending image.
 *
 * The cases that matter are the ones where a decision silently fails to stick:
 * row-level security refuses by returning zero rows and no error, so a refused
 * approval and a successful one arrive in the same shape.
 */
import { TestBed } from '@angular/core/testing';

import { ImageReviewService } from './image-review.service';
import { SupabaseService } from './supabase.service';

class FakeSupabase {
  /**
   * Null means "behave like Postgres": echo back the row as written. A fixed
   * `[{ id: 1 }]` was the old default, and it hid the very defect these tests
   * now cover — the service could not tell a saved decision from an unsaved
   * one, and neither could a fake that never returned a status.
   */
  updateReply: { data: unknown[] | null; error: unknown } | null = null;
  selectReply: { data: unknown[] | null; error: unknown } = { data: [], error: null };
  lastUpdate: Record<string, unknown> | null = null;
  lastStatusFilter: string | null = null;
  lastUpdateSelect: string | null = null;

  client = {
    from: () => ({
      select: () => ({
        eq: (_col: string, val: string) => {
          this.lastStatusFilter = val;
          return { order: async () => this.selectReply };
        },
      }),
      update: (patch: Record<string, unknown>) => {
        this.lastUpdate = patch;
        return {
          eq: () => ({
            select: async (cols: string) => {
              this.lastUpdateSelect = cols;
              return this.updateReply ?? { data: [{ id: 1, ...patch }], error: null };
            },
          }),
        };
      },
    }),
  };
}

const img = (id: number, status = 'pending') => ({
  id, car_id: 'c1', url: `${id}.jpg`, status,
  rejection_reason: null, submitted_by: 'rajesh@rkmotors.in',
  created_at: '2026-08-20T00:00:00Z',
}) as any;

describe('ImageReviewService', () => {
  let svc: ImageReviewService;
  let sb: FakeSupabase;

  beforeEach(() => {
    sb = new FakeSupabase();
    TestBed.configureTestingModule({
      providers: [ImageReviewService, { provide: SupabaseService, useValue: sb }],
    });
    svc = TestBed.inject(ImageReviewService);
  });

  it('opens on the pending queue', async () => {
    await svc.load();
    expect(sb.lastStatusFilter).toBe('pending');
  });

  it('approving sets the status and clears any old reason', async () => {
    svc.images.set([img(1)]);
    await svc.approve(1);

    expect(sb.lastUpdate).toEqual({ status: 'approved', rejection_reason: null });
  });

  it('never sends who reviewed it', async () => {
    // The database stamps reviewed_by from the caller's own token, so a
    // client-supplied value would be a forgery the server has to overrule.
    svc.images.set([img(1)]);
    await svc.approve(1);

    expect(Object.keys(sb.lastUpdate!)).not.toContain('reviewed_by');
    expect(Object.keys(sb.lastUpdate!)).not.toContain('reviewed_at');
  });

  it('refuses to reject without a reason', async () => {
    svc.images.set([img(1)]);

    await expectAsync(svc.reject(1, '   ')).toBeResolvedTo(false);
    // Nothing was sent at all.
    expect(sb.lastUpdate).toBeNull();
    expect(svc.error()).toBeTruthy();
  });

  it('sends a trimmed reason with a rejection', async () => {
    svc.images.set([img(1)]);
    await svc.reject(1, '  Number plate visible  ');

    expect(sb.lastUpdate).toEqual({ status: 'rejected', rejection_reason: 'Number plate visible' });
  });

  it('drops a decided image from the queue', async () => {
    // The admin is working down a list; reloading under them is how rows get
    // skipped.
    svc.images.set([img(1), img(2)]);
    await svc.approve(1);

    expect(svc.images().map(i => i.id)).toEqual([2]);
  });

  it('reports a decision that row-level security refused', async () => {
    // Zero rows, no error — a refusal and a success have the same shape.
    sb.updateReply = { data: [], error: null };
    svc.images.set([img(1)]);

    await expectAsync(svc.approve(1)).toBeResolvedTo(false);
    expect(svc.error()).toBeTruthy();
  });

  it('leaves a refused image in the queue', async () => {
    sb.updateReply = { data: [], error: null };
    svc.images.set([img(1)]);

    await svc.approve(1);
    expect(svc.images().length).toBe(1);
  });

  it('reports an outright error too', async () => {
    sb.updateReply = { data: null, error: { message: 'nope' } };
    svc.images.set([img(1)]);

    await expectAsync(svc.reject(1, 'Blurred')).toBeResolvedTo(false);
  });

  it('empties the list and says so when the queue cannot be read', async () => {
    sb.selectReply = { data: null, error: { message: 'denied' } };
    svc.images.set([img(1)]);

    await svc.load('pending');

    expect(svc.images()).toEqual([]);
    expect(svc.error()).toBeTruthy();
  });

  /**
   * A decision that did not stick must not read as one that did.
   *
   * Reported from production: rejecting an image put it straight back in the
   * Approved bucket. The database showed why — both rows carried reviewed_by
   * and reviewed_at (so the write path and the admin check were working)
   * while `status` had never once been 'rejected' and rejection_reason was
   * NULL. No rejection had ever landed, and the screen said nothing.
   *
   * The service asked for `id` alone and treated a returned row as proof. A
   * row coming back says the statement matched something; it says nothing
   * about what the row now holds.
   */
  describe('when a decision does not actually stick', () => {
    it('reads the status back, not just the key', async () => {
      await svc.approve(1);
      // Selecting 'id' alone cannot answer the question that matters.
      expect(sb.lastUpdateSelect).toContain('status');
    });

    it('fails when the row comes back with a different status', async () => {
      // Exactly the production shape: the update returns a row, still approved.
      sb.updateReply = { data: [{ id: 1, status: 'approved' }], error: null };
      svc.images.set([img(1, 'approved')]);

      const ok = await svc.reject(1, 'Number plate visible');

      expect(ok).toBe(false);
      expect(svc.error()).toContain('approved');
      expect(svc.error()).toContain('rejected');
      // And the row must stay on screen: dropping it is what made a failed
      // rejection look like a successful one.
      expect(svc.images().length).toBe(1);
    });

    it('reports what the database said instead of a fixed string', async () => {
      sb.updateReply = {
        data: null,
        error: { code: '42501', message: 'new row violates row-level security policy' },
      };

      const ok = await svc.approve(1);

      expect(ok).toBe(false);
      expect(svc.error()).toContain('42501');
      expect(svc.error()).toContain('row-level security');
    });

    it('names a refusal that returns no row and no error', async () => {
      sb.updateReply = { data: [], error: null };

      const ok = await svc.approve(1);

      expect(ok).toBe(false);
      expect(svc.error()).toContain('permissions');
      // Retrying an RLS refusal is pointless, and saying so saves a round.
      expect(svc.error()).toContain('not something retrying will fix');
    });

    it('still succeeds, and drops the row, when the status really changed', async () => {
      svc.images.set([img(1, 'pending')]);

      const ok = await svc.reject(1, 'Number plate visible');

      expect(ok).toBe(true);
      expect(svc.error()).toBe('');
      expect(svc.images()).toEqual([]);
      expect(sb.lastUpdate).toEqual({
        status: 'rejected', rejection_reason: 'Number plate visible',
      });
    });
  });
});
