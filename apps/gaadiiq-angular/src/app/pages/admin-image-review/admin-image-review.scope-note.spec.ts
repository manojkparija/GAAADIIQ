/**
 * Saying which uploads reach this queue — and changing nothing else.
 *
 * Photographs live in two tables (routers/media_admin.py). Dealer submissions
 * land in `car_images`, which this screen reads and which a database trigger
 * forces to `pending`. Admin uploads land in `vehicle_media` via
 * /media-admin/upload and go live without review, because the person uploading
 * is already the approver.
 *
 * Nothing on the page said so. An admin who had just uploaded a Fronx gallery
 * through Car Images came here, read "Nothing waiting for review", and
 * reasonably concluded the upload had failed — it had not; it was never going
 * to appear here.
 *
 * The fix is wording. These tests exist because wording is where it must stop:
 * the queue still loads, filters and defaults exactly as it did, and this file
 * fails if any of that moves.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { AdminImageReviewComponent } from './admin-image-review.component';
import { ImageReviewService, ReviewableImage } from '../../services/image-review.service';

/**
 * Real signals, not stubs. The component re-exposes these straight to the
 * template, so a plain object passes compilation and then dies at render with
 * "ctx.error is not a function" — and these tests render on purpose.
 */
class FakeReview {
  images = signal<ReviewableImage[]>([]);
  loading = signal(false);
  error = signal('');
  loaded: string[] = [];

  async load(status: string) {
    this.loaded.push(status);
  }
}

function mount(params: Record<string, string> = {}) {
  TestBed.resetTestingModule();
  const review = new FakeReview();
  TestBed.configureTestingModule({
    imports: [AdminImageReviewComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ImageReviewService, useValue: review },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(params) } },
      },
    ],
  });
  const fixture = TestBed.createComponent(AdminImageReviewComponent);
  fixture.detectChanges();
  return { fixture, review, el: fixture.nativeElement as HTMLElement };
}

describe('AdminImageReviewComponent — what this queue holds', () => {
  it('says only dealer submissions appear here', () => {
    const { el } = mount();

    expect(el.querySelector('.review-scope')?.textContent)
      .toContain('Only dealer submissions appear here');
  });

  it('points at Car Images, where an admin upload actually goes', () => {
    // A note that names the problem without naming the other screen leaves the
    // admin exactly as stuck.
    const { el } = mount();
    const link = el.querySelector('.review-scope a') as HTMLAnchorElement | null;

    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/admin/car-images');
  });

  it('says why the pending queue is empty, not just that it is', () => {
    const { el } = mount();

    expect(el.textContent).toContain('no dealer has submitted a photograph');
  });
});

describe('AdminImageReviewComponent — the flow is untouched', () => {
  it('still opens on pending by default', () => {
    const { review } = mount();

    expect(review.loaded).toEqual(['pending']);
  });

  it('still honours the status the link asked for', () => {
    // The manage panel's "Undo in the review queue →" depends on this.
    expect(mount({ status: 'rejected' }).review.loaded).toEqual(['rejected']);
    expect(mount({ status: 'approved' }).review.loaded).toEqual(['approved']);
  });

  it('still loads through the review service, not around it', () => {
    // The gate is in the database — a buyer's read policy matches only
    // approved rows, and a trigger refuses a status change from a non-admin.
    // This screen must stay a view of that, never a second path to it.
    const { review, fixture } = mount();
    (fixture.componentInstance as any).show('approved');

    expect(review.loaded).toEqual(['pending', 'approved']);
  });

  it('still offers all three tabs', () => {
    const { el } = mount();
    const tabs = Array.from(el.querySelectorAll('.rv-tab')).map(t => t.textContent?.trim());

    expect(tabs).toEqual(['Pending', 'Approved', 'Rejected']);
  });
});
