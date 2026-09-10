/**
 * An admin decides which photograph a buyer meets first.
 *
 * WHAT THIS COMES FROM
 *
 * The Baleno card on New Cars led with a photograph of the boot. Nothing was
 * wrong with the image, the car, or the approval — the gallery simply had no
 * order anyone had chosen. `car_images` numbers its rows in whatever sequence
 * the dealer dragged files in, and no screen could change it afterwards.
 *
 * The first photograph is the cover: urls_for_cars returns the gallery in
 * order and the listing card takes the head of it.
 *
 * THE PART THAT IS EASY TO GET WRONG
 *
 * The two stores do not order the same way.
 *
 *   vehicle_media  ORDER BY is_primary DESC, sort_order ASC, created_at
 *   car_images     ORDER BY sort_order NULLS LAST, created_at
 *
 * So for a media-library image, writing sort_order alone cannot move it to the
 * front — a flagged hero sits ahead of position 0 regardless. Whichever image
 * ends up first has to carry is_primary too, and car_images has no such column
 * to carry. Both are pinned below, because getting this wrong looks like
 * success on this screen and changes nothing for a buyer.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AdminCarImagesComponent } from './admin-car-images.component';

interface Call { url: string; method: string; body: any; }

function stubFetch(calls: Call[]) {
  (globalThis as any).fetch = (url: string, init: any = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(init.body) : null,
    });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) });
  };
}

function img(over: Partial<any> = {}): any {
  return {
    id: 'm1', filename: 'boot.jpg', url: 'https://cdn.test/boot.jpg',
    thumbnail_url: null, image_category: 'interior', variant: null, colour: null,
    media_bucket: 'new', origin: 'media_library', removable: true,
    sort_order: 0, is_cover: true,
    ...over,
  };
}

function mount(): AdminCarImagesComponent {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AdminCarImagesComponent, RouterTestingModule],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const c = TestBed.createComponent(AdminCarImagesComponent).componentInstance;
  // Re-reading after a write is the component's job; it is not what these
  // tests are about, and letting it run would overwrite the fixture.
  (c as any).loadExistingImages = () => Promise.resolve();
  return c;
}

describe('AdminCarImagesComponent — gallery order', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('swaps positions rather than renumbering', async () => {
    // Two images exchange places, so the set of numbers in use never changes
    // and no two images can claim the same position.
    const calls: Call[] = [];
    stubFetch(calls);
    const c = mount();
    c.existingImages.set([
      img({ id: 'boot', sort_order: 0 }),
      img({ id: 'front', sort_order: 1, is_cover: false }),
    ]);

    await c.moveImage(c.existingImages()[1], -1);

    const orders = calls.filter(x => x.method === 'PATCH').map(x => x.body.sort_order);
    expect(orders).toEqual([0, 1]);
  });

  it('gives the new front image the primary flag', async () => {
    // The one that decides whether this works at all. vehicle_media orders by
    // is_primary before sort_order, so without this the boot shot stays in
    // front and the admin sees a reordered panel with an unchanged website.
    const calls: Call[] = [];
    stubFetch(calls);
    const c = mount();
    c.existingImages.set([
      img({ id: 'boot', sort_order: 0, is_cover: true }),
      img({ id: 'front', sort_order: 1, is_cover: false }),
    ]);

    await c.moveImage(c.existingImages()[1], -1);

    const promoted = calls.find(x => x.url.includes('/front'));
    const demoted = calls.find(x => x.url.includes('/boot'));
    expect(promoted!.body.is_primary)
      .withContext('the image moving to position 0 becomes the cover')
      .toBeTrue();
    expect(demoted!.body.is_primary).toBeFalse();
  });

  it('sends a listing photograph to its own endpoint, without a primary flag', async () => {
    // car_images has no is_primary column. Sending one would be a field the
    // table cannot honour, and its order is sort_order alone.
    const calls: Call[] = [];
    stubFetch(calls);
    const c = mount();
    c.existingImages.set([
      img({ id: '7', origin: 'listing', sort_order: 0 }),
      img({ id: '8', origin: 'listing', sort_order: 1, is_cover: false }),
    ]);

    await c.moveImage(c.existingImages()[1], -1);

    const call = calls.find(x => x.url.includes('/8'))!;
    expect(call.url).toContain('/media-admin/listing-image/8/order');
    expect(call.body).toEqual({ sort_order: 0 });
    expect('is_primary' in call.body).toBeFalse();
  });

  it('does nothing at the ends of the list', async () => {
    // Guards the controls the template disables. A move off either end would
    // write a position no image occupies.
    const calls: Call[] = [];
    stubFetch(calls);
    const c = mount();
    c.existingImages.set([img({ id: 'a' }), img({ id: 'b' })]);

    await c.moveImage(c.existingImages()[0], -1);
    await c.moveImage(c.existingImages()[1], 1);

    expect(calls.filter(x => x.method === 'PATCH').length).toBe(0);
  });

  it('falls back to list position when the API sent no sort_order', async () => {
    // An older API build omits the field. Refusing to reorder because a
    // number is missing would disable the one thing this panel is for.
    const calls: Call[] = [];
    stubFetch(calls);
    const c = mount();
    c.existingImages.set([
      img({ id: 'a', sort_order: undefined }),
      img({ id: 'b', sort_order: undefined, is_cover: false }),
    ]);

    await c.moveImage(c.existingImages()[1], -1);

    const orders = calls.filter(x => x.method === 'PATCH').map(x => x.body.sort_order);
    expect(orders).toEqual([0, 1]);
  });

  it('reports a failure instead of implying the order changed', async () => {
    // A silent no-op is the failure mode that produced this report: the panel
    // looked right and the site did not change.
    (globalThis as any).fetch = () => Promise.resolve({
      ok: false, status: 500, text: () => Promise.resolve('boom'),
    });
    const c = mount();
    c.existingImages.set([img({ id: 'a' }), img({ id: 'b', is_cover: false })]);

    await c.moveImage(c.existingImages()[1], -1);

    expect(c.toastMsg()).toContain('Could not change the order');
  });
});
