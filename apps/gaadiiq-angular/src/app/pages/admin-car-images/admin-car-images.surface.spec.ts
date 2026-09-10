/**
 * A stored photograph says where it will actually be seen.
 *
 * WHAT THIS COMES FROM
 *
 * Reported: Baleno photographs uploaded and approved, but "not visible in the
 * new car section". Answering it took the read path traced by hand, because
 * nothing on screen separates the three ways it happens — and two of them look
 * identical in this panel, which lists every stored image while New Cars
 * filters them.
 *
 * THE THREE, AND WHY THE FIRST IS THE CRUEL ONE
 *
 *   1. media_bucket = 'used'. urls_for_cars applies exactly one filter beyond
 *      make/model/year, and this is it: New Cars asks for bucket='new' and
 *      matches 'new', 'both' or NULL. A 'used' image is stored, correct, and
 *      listed right here — and invisible to a buyer on New Cars. The admin is
 *      looking straight at the thing they cannot find.
 *   2. origin = 'listing'. A dealer's photograph belongs to their listing, not
 *      to a catalogue model, and no New Cars page reads that store at all.
 *   3. Nothing stored under this identity. The panel is empty, which is the
 *      one case that already announced itself.
 *
 * WHAT THIS IS NOT
 *
 * Display only. `media_bucket` has always been returned by /media-admin/list
 * and declared on VehicleImage; this page simply never rendered it. No image
 * changes bucket, no buyer sees anything different, and which photographs are
 * stored is untouched. The tests below pin that boundary as much as the
 * labels: the point is a panel that explains itself, not a new rule about
 * what appears where.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AdminCarImagesComponent } from './admin-car-images.component';

function mount(): AdminCarImagesComponent {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AdminCarImagesComponent, RouterTestingModule],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return TestBed.createComponent(AdminCarImagesComponent).componentInstance;
}

function image(over: Partial<any> = {}): any {
  return {
    id: 'i1', filename: 'baleno-front.jpg', url: 'https://cdn.test/1.jpg',
    thumbnail_url: null, image_category: 'exterior', variant: null,
    media_bucket: 'new', origin: 'media_library',
    ...over,
  };
}

describe('AdminCarImagesComponent — where a photograph is seen', () => {
  it('warns when an image serves Used Cars only', () => {
    // The reported shape: present in this panel, absent on New Cars, with
    // nothing on screen to explain the difference.
    const surface = mount().imageSurface(image({ media_bucket: 'used' }));

    expect(surface.label).toContain('not on New Cars');
    expect(surface.warn)
      .withContext('this is the case that costs an afternoon; it must stand out')
      .toBeTrue();
  });

  it('does not warn about an image that does reach New Cars', () => {
    const c = mount();

    expect(c.imageSurface(image({ media_bucket: 'new' })).warn).toBeFalse();
    expect(c.imageSurface(image({ media_bucket: 'both' })).warn).toBeFalse();
  });

  it('treats a missing bucket the way the read path does', () => {
    // urls_for_cars matches media_bucket IS NULL on either surface, so rows
    // stored before the column existed are not hidden. Saying "New Cars only"
    // here would be a different answer from the one buyers get.
    const surface = mount().imageSurface(image({ media_bucket: null }));

    expect(surface.label).toBe('New & Used Cars');
    expect(surface.warn).toBeFalse();
  });

  it('says a dealer photograph is not on catalogue pages', () => {
    // No New Cars page reads the listing store. Approving one in Image Review
    // publishes it to that listing, which is a different entity from a
    // catalogue model — the second of the three ways the report happens.
    const surface = mount().imageSurface(image({ origin: 'listing', media_bucket: 'new' }));

    expect(surface.label).toContain('not on catalogue pages');
  });

  it('lets origin outrank the bucket', () => {
    // A listing image can carry any bucket value; where it appears is decided
    // by it being a listing image, so that has to be answered first.
    const surface = mount().imageSurface(image({ origin: 'listing', media_bucket: 'used' }));

    expect(surface.label).toContain('From a listing');
    expect(surface.label).not.toContain('Used Cars only');
  });
});
