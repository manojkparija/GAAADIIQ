/**
 * The availability switch.
 *
 * Reported as "where is accepting option?" from the live dashboard. The
 * control was there — a bare rounded button reading "Not accepting", in the
 * same grey pill shape as the "Pending verification" status chip next to it.
 * It read as a second badge, so the only control on the page looked like a
 * label.
 *
 * A test that only calls toggleAvailability() would have passed throughout, so
 * these render the template and drive the actual element.
 */

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { MechanicDashboardComponent } from './mechanic-dashboard.component';
import { MarketplaceService } from '../../services/marketplace.service';

const PROFILE: any = {
  id: 'm-1',
  full_name: 'Parija Auto',
  shop_name: 'Parija Auto',
  city: 'Kolkata',
  area_pincode: '700102',
  jobs_completed: 0,
  rating: null,
  status: 'pending_verification',
  is_available: false,
};

describe('MechanicDashboardComponent availability switch', () => {
  let fixture: any;
  let component: any;
  let lastSet: { id: string; value: boolean } | null;

  beforeEach(() => {
    lastSet = null;
    TestBed.configureTestingModule({
      imports: [MechanicDashboardComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: MarketplaceService,
          useValue: {
            myMechanicProfile: () => Promise.resolve({ ...PROFILE }),
            myAssignedRequests: () => Promise.resolve([]),
            myOffers: () => Promise.resolve([]),
            setAvailability: (id: string, value: boolean) => {
              lastSet = { id, value };
              return Promise.resolve({ ...PROFILE, is_available: value });
            },
            formatPaise: (n: number) => `₹${n / 100}`,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(MechanicDashboardComponent);
    component = fixture.componentInstance;
  });

  /** Let the click's promise chain settle. */
  const flush = async () => {
    for (let i = 0; i < 10 && lastSet === null; i++) await Promise.resolve();
  };

  /** Put a profile on screen without depending on the load sequence. */
  const render = (profile: any = PROFILE) => {
    component.profile.set({ ...profile });
    component.loading?.set?.(false);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('offers the switch as a real control, not a status pill', () => {
    const el = render();
    const toggle = el.querySelector('.md-toggle') as HTMLButtonElement;

    expect(toggle).withContext('no availability control on the dashboard').not.toBeNull();
    // Announced as a switch, so it is reachable and obviously interactive
    // rather than reading as one more badge.
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.querySelector('.md-toggle-track'))
      .withContext('no switch track — this is what made it look like a label')
      .not.toBeNull();
  });

  it('names the state in full so it cannot be read as a status', () => {
    const el = render();
    // "Not accepting" beside a "Pending verification" chip reads as a status.
    expect(el.querySelector('.md-toggle-text')!.textContent!.trim())
      .toBe('Not accepting jobs');
  });

  it('turns availability on when clicked', async () => {
    const el = render();
    (el.querySelector('.md-toggle') as HTMLButtonElement).click();
    // Not whenStable(): the dashboard polls, so the zone is never quiet. Wait
    // for the work this click actually starts.
    await flush();

    expect(lastSet).toEqual({ id: 'm-1', value: true });
    fixture.detectChanges();
    expect((el.querySelector('.md-toggle') as HTMLElement).getAttribute('aria-checked')).toBe('true');
  });

  it('does not ask for offers while the account is pending', async () => {
    // /service-requests/offers/available 403s for anyone but an active
    // mechanic. The poll asked anyway and failed silently, so production
    // logged an unbroken run of 403s — one a minute, for as long as the
    // dashboard stayed open.
    let asked = 0;
    const market = TestBed.inject(MarketplaceService) as any;
    market.myOffers = () => { asked++; return Promise.resolve([]); };

    component.profile.set({ ...PROFILE, status: 'pending_verification' });
    await (component as any).pollOffers();
    expect(asked).withContext('polled an endpoint that cannot succeed').toBe(0);
  });

  it('asks for offers once the account is active', async () => {
    let asked = 0;
    const market = TestBed.inject(MarketplaceService) as any;
    market.myOffers = () => { asked++; return Promise.resolve([]); };

    component.profile.set({ ...PROFILE, status: 'active' });
    await (component as any).pollOffers();
    expect(asked).toBe(1);
  });

  it('is usable before approval, and says when it takes effect', () => {
    // Availability is the mechanic's own preference; verification is ours.
    // Disabling it while pending would leave them nothing to do but wait, and
    // the API accepts the change either way.
    const el = render({ ...PROFILE, status: 'pending_verification' });
    expect((el.querySelector('.md-toggle') as HTMLButtonElement).disabled).toBe(false);
    expect(el.querySelector('.md-note')!.textContent).toContain('takes effect');
  });
});
