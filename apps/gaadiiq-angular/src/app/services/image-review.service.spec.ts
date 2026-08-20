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
  updateReply: { data: unknown[] | null; error: unknown } = { data: [{ id: 1 }], error: null };
  selectReply: { data: unknown[] | null; error: unknown } = { data: [], error: null };
  lastUpdate: Record<string, unknown> | null = null;
  lastStatusFilter: string | null = null;

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
        return { eq: () => ({ select: async () => this.updateReply }) };
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
});
