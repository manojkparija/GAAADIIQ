/**
 * The mechanic verification queue.
 *
 * Registration only ever writes a `pending_verification` row, and only
 * `active` mechanics can be dispatched a job. Both admin endpoints existed
 * from the start — `GET /mechanics?status=…` and `PATCH /mechanics/{id}/verify`
 * — but nothing ever called them, so an admin who registered a mechanic was
 * told to await a verification that no screen could perform.
 *
 * These drive the component against a stubbed `fetch`, asserting the requests
 * it actually makes.
 */

import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AdminMechanicsComponent } from './admin-mechanics.component';
import { SupabaseService } from '../../services/supabase.service';

const PENDING = {
  id: 'e1f2a3b4-0000-4000-8000-000000000001',
  full_name: 'Rakesh Kumar',
  shop_name: 'Rakesh Auto Works',
  phone: '9903411202',
  whatsapp_phone: null,
  email: null,
  address_line1: 'DG Block',
  address_line2: null,
  city: 'Kolkata',
  state: 'West Bengal',
  area_pincode: '700156',
  service_radius_km: 10,
  pan_number: 'ABCDE****F',
  aadhaar_masked: '**** **** 1234',
  upi_vpa: null,
  specialisations: ['Engine'],
  status: 'pending_verification',
  is_available: false,
  rating: null,
  jobs_completed: 0,
  created_at: '2026-08-15T06:00:00Z',
};

describe('AdminMechanicsComponent', () => {
  let component: any;
  let calls: { url: string; init: any }[];

  /** Stub fetch: first call is the listing, later ones the decision. */
  const stubFetch = (responder: (url: string) => { ok: boolean; status?: number; body?: any }) => {
    calls = [];
    spyOn(window, 'fetch').and.callFake(((url: string, init: any) => {
      calls.push({ url: String(url), init });
      const r = responder(String(url));
      return Promise.resolve({
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 500),
        json: () => Promise.resolve(r.body ?? {}),
      } as Response);
    }) as any);
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminMechanicsComponent],
      providers: [
        // RouterLink in the template needs a router present.
        provideRouter([]),
        {
          provide: SupabaseService,
          useValue: {
            client: {
              auth: {
                getSession: () =>
                  Promise.resolve({ data: { session: { access_token: 'test-token' } } }),
              },
            },
          },
        },
      ],
    });
  });

  /** Build the component after fetch is stubbed — the constructor loads. */
  const create = () => {
    component = TestBed.createComponent(AdminMechanicsComponent).componentInstance;
    return component;
  };

  it('asks for the pending queue, with the admin token attached', async () => {
    stubFetch(() => ({ ok: true, body: [PENDING] }));
    create();
    await component.load();

    const listing = calls.find(c => c.url.includes('/mechanics?'));
    expect(listing).withContext('no listing request was made').toBeDefined();
    expect(listing!.url).toContain('status=pending_verification');
    // The admin endpoints 403 without it, which is what an empty screen would
    // look like from the outside.
    expect(listing!.init.headers.Authorization).toBe('Bearer test-token');
  });

  it('approves through the verify endpoint and drops the row', async () => {
    stubFetch(url => (url.includes('/verify') ? { ok: true, body: {} } : { ok: true, body: [PENDING] }));
    create();
    await component.load();
    expect(component.mechanics().length).toBe(1);

    await component.approve(PENDING);

    const verify = calls.find(c => c.url.includes('/verify'));
    expect(verify).withContext('no verify request was made').toBeDefined();
    expect(verify!.url).toContain(PENDING.id);
    expect(verify!.init.method).toBe('PATCH');
    expect(JSON.parse(verify!.init.body)).toEqual({ approve: true, reason: null });
    // Gone from the pending tab, because it is no longer pending.
    expect(component.mechanics().length).toBe(0);
  });

  it('will not reject without a reason', async () => {
    stubFetch(() => ({ ok: true, body: [PENDING] }));
    create();
    await component.load();

    component.startReject(PENDING);
    component.rejectReason = '   ';
    await component.confirmReject(PENDING);

    // A bare "rejected" is not something the mechanic can act on.
    expect(calls.some(c => c.url.includes('/verify'))).toBe(false);
    expect(component.mechanics().length).toBe(1);
  });

  it('sends the reason with a rejection', async () => {
    stubFetch(url => (url.includes('/verify') ? { ok: true, body: {} } : { ok: true, body: [PENDING] }));
    create();
    await component.load();

    component.startReject(PENDING);
    component.rejectReason = 'PAN does not match the name given';
    await component.confirmReject(PENDING);

    const verify = calls.find(c => c.url.includes('/verify'))!;
    expect(JSON.parse(verify.init.body)).toEqual({
      approve: false,
      reason: 'PAN does not match the name given',
    });
  });

  it('says a 403 is a permissions problem, not a missing queue', async () => {
    // An admin-only endpoint refusing a non-admin looks exactly like an empty
    // queue unless the screen says otherwise.
    stubFetch(() => ({ ok: false, status: 403 }));
    create();
    await component.load();

    expect(component.error()).toContain('admin');
    expect(component.mechanics()).toEqual([]);
  });

  it('renders the mechanic, the KYC and a working Approve button', async () => {
    // A green suite that never renders the template proves the class works and
    // says nothing about the screen. Both existing admin pages shipped with
    // their titles hidden under the navbar precisely because nobody looked.
    stubFetch(url => (url.includes('/verify') ? { ok: true, body: {} } : { ok: true, body: [PENDING] }));
    const fixture = TestBed.createComponent(AdminMechanicsComponent);
    component = fixture.componentInstance;
    await component.load();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const card = el.querySelector('.am-card');
    expect(card).withContext('no mechanic card rendered').not.toBeNull();
    expect(card!.textContent).toContain('Rakesh Kumar');
    expect(card!.textContent).toContain('9903411202');
    // KYC is on screen, because approving asserts someone checked it.
    expect(card!.textContent).toContain('ABCDE****F');
    expect(card!.textContent).toContain('**** **** 1234');
    // Aadhaar appears masked and never in full.
    expect(el.textContent).not.toContain('123456789');

    const approve = card!.querySelector('.am-btn--approve') as HTMLButtonElement;
    expect(approve).withContext('no Approve button').not.toBeNull();
    approve.click();
    await fixture.whenStable();
    expect(calls.some(c => c.url.includes('/verify'))).toBe(true);
  });

  it('finds a mechanic by phone number', async () => {
    stubFetch(() => ({ ok: true, body: [PENDING] }));
    create();
    await component.load();

    component.search.set('9903411202');
    expect(component.visible().length).toBe(1);

    component.search.set('9999999999');
    expect(component.visible().length).toBe(0);
  });
});
