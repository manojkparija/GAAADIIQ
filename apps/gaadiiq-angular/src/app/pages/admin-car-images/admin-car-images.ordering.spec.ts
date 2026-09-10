/**
 * An admin decides which photograph a buyer meets first — from either store.
 *
 * WHAT THIS COMES FROM, AND WHAT THESE TESTS MISSED THE FIRST TIME
 *
 * The Baleno card on New Cars led with a photograph of the boot. The first
 * attempt at a fix gave each image ↑/↓ buttons that swapped `sort_order` with
 * its neighbour. On screen that looked right. In practice, pressing ↑ on the
 * first dealer photograph did nothing at all.
 *
 * The gallery is not one list. Photographs live in two tables that number
 * their rows independently, each from zero, and both the API listing and
 * urls_for_cars returned the curated ones followed by the dealer ones. So a
 * position meant nothing outside its own table: swapping numbers across the
 * boundary moved neither image, and quietly disturbed the curated half's
 * internal order on the way.
 *
 * The earlier version of this file set up a single flat array of images, so it
 * could not see any of that — it tested a gallery shape the app never had.
 * That is the blind spot that let the bug ship, and it is why these tests now
 * always mix the two origins.
 *
 * THE FIX UNDER TEST
 *
 * A move sends the car's WHOLE gallery, in its new order, to one endpoint that
 * renumbers every photograph into a single 0..n-1 sequence. Distinct positions
 * across the two stores are also the signal the read path uses to know this
 * car was arranged, so a partial write would be worse than none.
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

/** A curated photograph — vehicle_media, UUID id. */
function curated(id: string, over: Partial<any> = {}): any {
  return {
    id, filename: `${id}.jpg`, url: `https://cdn.test/${id}.jpg`,
    thumbnail_url: null, image_category: 'gallery', variant: null, colour: null,
    media_bucket: 'new', origin: 'media_library', removable: true,
    sort_order: 0, is_cover: false, ...over,
  };
}

/** A dealer photograph — car_images, integer id. */
function dealer(id: string, over: Partial<any> = {}): any {
  return {
    id, filename: `${id}.jpg`, url: `https://cdn.test/${id}.jpg`,
    thumbnail_url: null, image_category: null, variant: null, colour: null,
    media_bucket: null, origin: 'listing', removable: true,
    sort_order: 0, is_cover: false, ...over,
  };
}

function mount(): AdminCarImagesComponent {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AdminCarImagesComponent, RouterTestingModule],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const c = TestBed.createComponent(AdminCarImagesComponent).componentInstance;
  // Re-reading after a write is the component's job and not what these tests
  // are about; letting it run would overwrite the fixture.
  (c as any).loadExistingImages = () => Promise.resolve();
  return c;
}

/** The reported gallery: four curated images, then the dealer photographs. */
function balenoGallery() {
  return [
    curated('m1', { is_cover: true }), curated('m2'), curated('m3'), curated('m4'),
    dealer('5'), dealer('6'), dealer('7'),
  ];
}

function orderCall(calls: Call[]) {
  return calls.find(c => c.url.includes('/vehicle-images/order'));
}

describe('AdminCarImagesComponent — gallery order across both stores', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('carries a dealer photograph past the curated ones', async () => {
    // THE REPORTED BUG. Image 5 is the first dealer photograph and sits right
    // behind the last curated one. Pressing ↑ used to swap two numbers in
    // different numbering spaces and move nothing.
    const calls: Call[] = [];
    stubFetch(calls);
    const c = mount();
    c.existingImages.set(balenoGallery());

    await c.moveImage(c.existingImages()[4], -1);

    const sent = orderCall(calls)!.body.images.map((i: any) => i.id);
    expect(sent).toEqual(['m1', 'm2', 'm3', '5', 'm4', '6', '7']);
  });

  it('can take a dealer photograph all the way to the cover', async () => {
    // What actually puts a real front shot on the Baleno card. Under the old
    // rule no dealer photograph could ever lead, however many times it moved.
    const calls: Call[] = [];
    stubFetch(calls);
    const c = mount();
    c.existingImages.set([curated('m1', { is_cover: true }), dealer('7')]);

    await c.moveImage(c.existingImages()[1], -1);

    const sent = orderCall(calls)!.body.images.map((i: any) => i.id);
    expect(sent[0])
      .withContext('the dealer photograph is now the cover')
      .toBe('7');
  });

  it('sends the whole gallery, not only the images that moved', async () => {
    // Distinct positions across the two tables are what tell the read path
    // this car was arranged. A partial write could make them distinct by
    // accident and switch a gallery to an order nobody chose.
    const calls: Call[] = [];
    stubFetch(calls);
    const c = mount();
    c.existingImages.set(balenoGallery());

    await c.moveImage(c.existingImages()[6], -1);

    expect(orderCall(calls)!.body.images.length).toBe(7);
  });

  it('names the table each photograph lives in', async () => {
    // The endpoint writes to two tables keyed differently — a UUID in
    // vehicle_media, an integer in car_images — so it cannot guess.
    const calls: Call[] = [];
    stubFetch(calls);
    const c = mount();
    c.existingImages.set([curated('m1'), dealer('5')]);

    await c.moveImage(c.existingImages()[1], -1);

    expect(orderCall(calls)!.body.images).toEqual([
      { id: '5', origin: 'listing' },
      { id: 'm1', origin: 'media_library' },
    ]);
  });

  it('treats a photograph with no origin as curated', async () => {
    // An older API build does not send the field, and every row was a
    // media-library one before listing photographs were listed here.
    const calls: Call[] = [];
    stubFetch(calls);
    const c = mount();
    c.existingImages.set([curated('m1', { origin: undefined }), curated('m2')]);

    await c.moveImage(c.existingImages()[1], -1);

    expect(orderCall(calls)!.body.images[1].origin).toBe('media_library');
  });

  it('moves down as well as up', async () => {
    const calls: Call[] = [];
    stubFetch(calls);
    const c = mount();
    c.existingImages.set([curated('m1'), dealer('5'), dealer('6')]);

    await c.moveImage(c.existingImages()[0], 1);

    expect(orderCall(calls)!.body.images.map((i: any) => i.id)).toEqual(['5', 'm1', '6']);
  });

  it('does nothing at the ends of the list', async () => {
    // Guards the controls the template disables. A move off either end would
    // renumber the gallery for no reason.
    const calls: Call[] = [];
    stubFetch(calls);
    const c = mount();
    c.existingImages.set([curated('m1'), dealer('5')]);

    await c.moveImage(c.existingImages()[0], -1);
    await c.moveImage(c.existingImages()[1], 1);

    expect(calls.filter(x => x.method === 'PUT').length).toBe(0);
  });

  it('reports a failure instead of implying the order changed', async () => {
    // A silent no-op is exactly what produced this report: the panel looked
    // right and the site did not change.
    (globalThis as any).fetch = () => Promise.resolve({
      ok: false, status: 500, text: () => Promise.resolve('boom'),
    });
    const c = mount();
    c.existingImages.set([curated('m1'), dealer('5')]);

    await c.moveImage(c.existingImages()[1], -1);

    expect(c.toastMsg()).toContain('Could not change the order');
  });
});
