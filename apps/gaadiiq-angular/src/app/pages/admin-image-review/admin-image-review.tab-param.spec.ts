/**
 * The review queue opens on the tab it was sent to.
 *
 * Reported: the manage panel's "Undo in the review queue →" link landed on
 * Pending, which showed "Nothing waiting for review" — because a removed
 * photograph is *rejected*, not pending. The admin was given a link, followed
 * it, and found an empty page, with no way to tell a working undo from a
 * broken link.
 *
 * Pending stays the default for a plain visit: that is the queue's job, and
 * opening somewhere else for everyone would be a worse bug than the one being
 * fixed.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { AdminImageReviewComponent } from './admin-image-review.component';
import { ImageReviewService } from '../../services/image-review.service';

class FakeReview {
  images = { set: () => {} } as any;
  loading = { set: () => {} } as any;
  error = { set: () => {} } as any;
  loaded: string[] = [];

  async load(status: string) {
    this.loaded.push(status);
  }
}

function mount(params: Record<string, string>) {
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
  return { c: fixture.componentInstance as any, review };
}

describe('AdminImageReviewComponent — opening on a requested tab', () => {
  it('opens on Rejected when sent there', () => {
    const { c, review } = mount({ status: 'rejected' });

    expect(c.filter()).toBe('rejected');
    // Both matter: the tab has to look right AND the right queue has to be
    // fetched. Setting one without the other shows an empty Rejected tab.
    expect(review.loaded).toEqual(['rejected']);
  });

  it('opens on Approved when sent there', () => {
    const { c, review } = mount({ status: 'approved' });

    expect(c.filter()).toBe('approved');
    expect(review.loaded).toEqual(['approved']);
  });

  it('still opens on Pending for a plain visit', () => {
    const { c, review } = mount({});

    expect(c.filter()).toBe('pending');
    expect(review.loaded).toEqual(['pending']);
  });

  it('ignores a status it does not recognise', () => {
    // Rather than passing it through to the API, which would query a status
    // no policy matches and show an empty queue with no explanation.
    const { c, review } = mount({ status: 'deleted' });

    expect(c.filter()).toBe('pending');
    expect(review.loaded).toEqual(['pending']);
  });
});
