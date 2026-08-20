/**
 * A dealer adding photographs to their own car.
 *
 * The dealer dashboard's Inventory tab showed the shared catalogue library and
 * offered one action: a link to /admin/car-images, which sits behind
 * adminGuard and no dealer can open. The endpoint behind the gallery also
 * required an admin, so a real dealer received a 403 that the page rendered as
 * "No images yet" — the tab has never worked for a dealer, and failed in a way
 * that looked like an empty account.
 *
 * These cover the same class of failure one layer down. Supabase row-level
 * security refuses a write by returning zero rows and no error, so "refused"
 * and "succeeded" arrive in the same shape. Anything that does not check what
 * came back will report success and drop the photo on the next reload.
 */
import { TestBed } from '@angular/core/testing';

import { DealerCarImagesService } from './dealer-car-images.service';
import { ImageUploadService } from './image-upload.service';
import { SupabaseService } from './supabase.service';

class FakeSupabase {
  insertReply: { data: unknown[] | null; error: unknown } = { data: [{ id: 9, car_id: CAR, url: 'u', sort_order: 0 }], error: null };
  deleteReply: { data: unknown[] | null; error: unknown } = { data: [{ id: 5 }], error: null };
  selectReply: { data: unknown[] | null; error: unknown } = { data: [], error: null };
  lastInsert: unknown[] | null = null;

  client = {
    from: () => ({
      select: () => ({ eq: () => ({ order: async () => this.selectReply }) }),
      insert: (rows: unknown[]) => {
        this.lastInsert = rows;
        return { select: async () => this.insertReply };
      },
      delete: () => ({ eq: () => ({ select: async () => this.deleteReply }) }),
    }),
  };
}

class FakeUploader {
  shouldThrow = false;
  async uploadFiles(files: File[], folder: string) {
    if (this.shouldThrow) throw new Error('storage is full');
    this.folder = folder;
    return files.map((f, i) => ({ path: `${folder}/${i}`, url: `https://cdn/${f.name}` }));
  }
  folder = '';
}

// cars.id is a uuid, not a number. The first version of this feature typed it
// as a number and called Number() on it, which yields NaN.
const CAR = '3f7c1e2a-9b40-4d51-8a6e-1c2d3e4f5a6b';
const OTHER = '8d2b4c6e-1a30-4f52-9c7d-2e3f4a5b6c7d';

const png = (name: string) => new File([new Uint8Array(8)], name, { type: 'image/png' });

describe('DealerCarImagesService', () => {
  let svc: DealerCarImagesService;
  let sb: FakeSupabase;
  let up: FakeUploader;

  beforeEach(() => {
    sb = new FakeSupabase();
    up = new FakeUploader();
    TestBed.configureTestingModule({
      providers: [
        DealerCarImagesService,
        { provide: SupabaseService, useValue: sb },
        { provide: ImageUploadService, useValue: up },
      ],
    });
    svc = TestBed.inject(DealerCarImagesService);
  });

  it('files photos under the car they belong to', async () => {
    await svc.add(CAR, [png('front.png')]);
    expect(up.folder).toBe(`listings/${CAR}`);
  });

  it('records each photo against that car', async () => {
    await svc.add(OTHER, [png('a.png')]);
    expect((sb.lastInsert as any[])[0].car_id).toBe(OTHER);
  });

  it('numbers new photos after the ones already there', async () => {
    svc.images.set([
      { id: 1, car_id: CAR, url: 'x', sort_order: 0 },
      { id: 2, car_id: CAR, url: 'y', sort_order: 1 },
    ]);
    await svc.add(CAR, [png('c.png')]);
    expect((sb.lastInsert as any[])[0].sort_order).toBe(2);
  });

  it('reports failure when the row insert is refused', async () => {
    // Zero rows, no error — how RLS says "not your car".
    sb.insertReply = { data: [], error: null };
    await expectAsync(svc.add(CAR, [png('a.png')])).toBeResolvedTo(false);
    expect(svc.error()).toBeTruthy();
  });

  it('does not add a refused photo to the gallery', async () => {
    sb.insertReply = { data: [], error: null };
    await svc.add(CAR, [png('a.png')]);
    expect(svc.images().length).toBe(0);
  });

  it('surfaces a storage failure rather than throwing at the caller', async () => {
    up.shouldThrow = true;
    await expectAsync(svc.add(CAR, [png('a.png')])).toBeResolvedTo(false);
    expect(svc.error()).toContain('storage is full');
  });

  it('keeps a photo on screen when the delete is refused', async () => {
    // Otherwise it vanishes and returns on the next load, which reads as the
    // app losing the change rather than refusing it.
    svc.images.set([{ id: 5, car_id: CAR, url: 'x', sort_order: 0 }]);
    sb.deleteReply = { data: [], error: null };

    await expectAsync(svc.remove(5)).toBeResolvedTo(false);
    expect(svc.images().length).toBe(1);
    expect(svc.error()).toBeTruthy();
  });

  it('removes a photo the database agreed to delete', async () => {
    svc.images.set([{ id: 5, car_id: CAR, url: 'x', sort_order: 0 }]);
    await expectAsync(svc.remove(5)).toBeResolvedTo(true);
    expect(svc.images().length).toBe(0);
  });

  it('does nothing at all when handed no files', async () => {
    await expectAsync(svc.add(CAR, [])).toBeResolvedTo(true);
    expect(sb.lastInsert).toBeNull();
  });
});
