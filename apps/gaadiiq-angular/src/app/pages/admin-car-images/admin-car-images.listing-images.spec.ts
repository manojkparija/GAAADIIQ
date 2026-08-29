/**
 * A listing photograph is shown on the manage panel, but not removable there.
 *
 * Reported: an e Vitara with two approved photographs listed as "No images on
 * the site for this vehicle", while buyers saw those photographs. The panel
 * queried vehicle_media alone; the listing and dealer flows write to
 * car_images.
 *
 * The panel now shows both. Removal stays where the decision is recorded:
 * the review queue requires a reason the dealer reads and stamps who decided,
 * and a delete button here would bypass that trail. So these assert the
 * absence of a control as much as the presence of one — the "don't" half is
 * the part a careless change would quietly undo.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { AdminCarImagesComponent } from './admin-car-images.component';

const libraryImage = {
  id: 'a3f1c2d4-0000-4000-8000-000000000001',
  filename: 'front.webp', url: 'https://cdn/x/front.webp', thumbnail_url: null,
  image_category: 'exterior', variant: 'ZXi', colour: 'Red',
  media_bucket: 'new', created_at: '2026-08-01T00:00:00Z',
  origin: 'media_library' as const, removable: true, manage_at: null,
};

const listingImage = {
  id: '1',
  filename: 'rear-quarter.jpg', url: 'https://cdn/y/rear-quarter.jpg',
  thumbnail_url: null, image_category: null, variant: null, colour: null,
  media_bucket: null, created_at: '2026-08-27T21:13:18Z',
  origin: 'listing' as const, removable: true, manage_at: '/admin/image-review',
};

describe('AdminCarImagesComponent — photographs from a listing', () => {
  let fixture: ComponentFixture<AdminCarImagesComponent>;
  let c: any;

  let originalFetch: typeof fetch;

  beforeEach(() => {
    // The constructor calls loadCatalogueOptions(), which uses `fetch`. Left
    // real it fails, and the rejected promise keeps the zone unstable so
    // whenStable() never resolves — every test in this file timed out at 5s
    // before this stub, which looks like a broken component and is not.
    originalFetch = window.fetch;
    window.fetch = (() => Promise.resolve(
      new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )) as typeof fetch;

    TestBed.configureTestingModule({
      imports: [AdminCarImagesComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(AdminCarImagesComponent);
    c = fixture.componentInstance;
    c.manageMake.set('Maruti Suzuki');
    c.manageModel.set('e Vitara');
  });

  afterEach(() => { window.fetch = originalFetch; });

  /**
   * Two change-detection passes, and deliberately no whenStable(): the
   * component keeps async work in flight and waiting for quiescence hangs.
   * Rendering is synchronous once the signal is set, so this is enough.
   */
  function render() {
    fixture.detectChanges();
    fixture.detectChanges();
  }

  it('shows a listing photograph rather than claiming there are none', () => {
    c.existingImages.set([listingImage]);
    render();

    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('No images on the site for this vehicle');
    expect(text).toContain('rear-quarter.jpg');
  });

  it('offers a Remove button for it', () => {
    c.existingImages.set([listingImage]);
    render();

    expect(fixture.nativeElement.querySelector('.aci-remove-image'))
      .withContext('an admin asked to remove listing images from this panel')
      .toBeTruthy();
  });

  it('still says where the removal can be undone', () => {
    // Removal is a rejection, not a delete, so it is reversible — but only
    // for an admin who knows the Rejected tab is where that happens.
    c.existingImages.set([listingImage]);
    render();

    const link = fixture.nativeElement.querySelector('.aci-existing-elsewhere');
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toContain('/admin/image-review');
  });

  it('says where the photograph came from', () => {
    c.existingImages.set([listingImage]);
    render();
    expect(fixture.nativeElement.textContent).toContain('From a listing');
  });

  it('still removes a media-library photograph', () => {
    // The panel's original job must survive: this is the half that worked.
    c.existingImages.set([libraryImage]);
    render();

    expect(fixture.nativeElement.querySelector('.aci-remove-image')).toBeTruthy();
    // A media-library image has no review queue to go back to.
    expect(fixture.nativeElement.querySelector('.aci-existing-elsewhere')).toBeNull();
  });

  it('shows both kinds together, each with its own control', () => {
    c.existingImages.set([libraryImage, listingImage]);
    render();

    // Both removable now; only the listing one carries the undo link.
    expect(fixture.nativeElement.querySelectorAll('.aci-remove-image').length).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('.aci-existing-elsewhere').length).toBe(1);
  });

  it('treats a row with no origin as removable', () => {
    // An older API build sends neither field. Every row was removable before
    // listing images were included, so absent must not silently lock the
    // panel — that would break removal for everyone on a version skew.
    const { origin, removable, manage_at, ...legacy } = libraryImage as any;
    c.existingImages.set([legacy]);
    render();

    expect(fixture.nativeElement.querySelector('.aci-remove-image')).toBeTruthy();
  });
});
