/**
 * Deleting a catalogue row that a withdrawn advert still references.
 *
 * REPORTED FROM PRODUCTION
 *
 * "I have deleted it from the frontend but it's still in the catalogue." The
 * Render log had the answer:
 *
 *     DELETE /cars/26cb4486-... HTTP/1.1" 409 Conflict
 *
 * Taking an advert down is a SOFT delete — the listing row survives with
 * is_active = false so the seller keeps their history — and delete_car counted
 * every listing regardless. So a withdrawn advert blocked the catalogue row
 * permanently, while the refusal told the admin to "remove those listings
 * first", which was not a thing the product could do.
 *
 * The API now refuses once, naming the count, and deletes on a second call
 * carrying acknowledge_withdrawn. These pin the screen's half of that: the
 * count has to reach the admin BEFORE the click that destroys those rows, and
 * the confirm button must not appear for a live advert, which is never
 * overridable.
 *
 * fetch() rather than HttpClient in the component under test, so these stub
 * fetch instead of using HttpTestingController.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { AdminVariantsComponent } from './admin-variants.component';

describe('AdminVariantsComponent — a withdrawn advert blocking a delete', () => {
  let c: any;
  let calls: string[];

  const CAR = { id: 'car-1', make: 'Maruti Suzuki', model: 'Swift', year: 2026 };

  /** Answer each DELETE in order, recording the URL each time. */
  function respondWith(...responses: { status: number; body?: any }[]) {
    let i = 0;
    spyOn(window, 'fetch').and.callFake(((url: string) => {
      calls.push(String(url));
      const r = responses[Math.min(i++, responses.length - 1)];
      return Promise.resolve({
        status: r.status,
        ok: r.status >= 200 && r.status < 300,
        json: () => Promise.resolve(r.body),
      } as Response);
    }) as any);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminVariantsComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    c = TestBed.createComponent(AdminVariantsComponent).componentInstance;
    calls = [];
    spyOn(c as any, 'authHeaders').and.returnValue(Promise.resolve({}));
    spyOn(c as any, 'loadCars').and.returnValue(Promise.resolve());
    c.cars.set([CAR]);
    c.selectedCarId.set(CAR.id);
    c.askDeleteCar();
  });

  it('shows the number of withdrawn adverts rather than deleting them', async () => {
    respondWith({
      status: 409,
      body: { detail: { blocker: 'withdrawn', count: 2, message: '2 withdrawn advert(s) reference this car.' } },
    });

    await c.deleteCar();

    expect(c.deleteError()).toContain('2 withdrawn advert(s)');
    expect(c.withdrawnBlocking()).toBe(2);
    // One call, and it did NOT carry the acknowledgement: the first attempt
    // must never be the one that destroys the rows.
    expect(calls.length).toBe(1);
    expect(calls[0]).not.toContain('acknowledge_withdrawn');
  });

  it('sends the acknowledgement only on the second, deliberate click', async () => {
    respondWith(
      { status: 409, body: { detail: { blocker: 'withdrawn', count: 1, message: '1 withdrawn advert(s).' } } },
      { status: 204 },
    );

    await c.deleteCar();
    await c.deleteCar(true);

    expect(calls[1]).toContain('acknowledge_withdrawn=true');
    expect(c.withdrawnBlocking()).toBe(0);
    expect(c.confirmingDelete()).toBeFalse();
  });

  it('offers no confirm button for a live advert', async () => {
    // THE ONE THAT MATTERS MOST. A live advert is never overridable, so the
    // screen must not grow a button that looks like it overrides it.
    respondWith({
      status: 409,
      body: { detail: { blocker: 'live', count: 1, message: '1 live advert(s) point at this car.' } },
    });

    await c.deleteCar();

    expect(c.deleteError()).toContain('live advert(s)');
    expect(c.withdrawnBlocking()).toBe(0);
  });

  it('clears a previous refusal when the admin asks again', async () => {
    respondWith({
      status: 409,
      body: { detail: { blocker: 'withdrawn', count: 3, message: '3 withdrawn advert(s).' } },
    });
    await c.deleteCar();

    c.cancelDeleteCar();
    c.askDeleteCar();

    // Otherwise a stale count keeps the destructive button on screen for a
    // row the admin has not tried to delete yet.
    expect(c.withdrawnBlocking()).toBe(0);
    expect(c.deleteError()).toBe('');
  });

  it('still reads a plain-string detail', async () => {
    // Older deployments, and any refusal raised elsewhere, send detail as a
    // sentence. Rendering "[object Object]" at an admin is worse than the 409.
    respondWith({ status: 409, body: { detail: 'This car still has listings against it.' } });

    await c.deleteCar();

    expect(c.deleteError()).toBe('This car still has listings against it.');
    expect(c.withdrawnBlocking()).toBe(0);
  });
});
