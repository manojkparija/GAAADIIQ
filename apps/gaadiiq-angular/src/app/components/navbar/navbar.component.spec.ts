/**
 * The mobile menu.
 *
 * On a phone this menu *is* the navigation, and it had no route to the
 * mechanic side of the product at all: the signed-in block only offered
 * dashboards to sellers and admins, and a mechanic is neither. So a mechanic
 * on a phone could reach neither their own dashboard nor registration —
 * reported as "I want to register as a mechanic but that option is not
 * available" and "one mechanic only sees the service request, no other
 * information".
 *
 * These assert against the rendered menu, since the fault was an absent
 * element rather than a broken one.
 */

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { NavbarComponent } from './navbar.component';
import { AuthService } from '../../services/auth.service';

describe('NavbarComponent mobile menu', () => {
  let fixture: any;
  let component: any;
  let auth: AuthService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [NavbarComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(NavbarComponent);
    component = fixture.componentInstance;
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => localStorage.clear());

  /** Open the menu and hand back its links. */
  const openMenu = (): HTMLElement => {
    component.menuOpen.set(true);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('.mobile-menu') as HTMLElement;
  };

  const hrefs = (menu: HTMLElement) =>
    Array.from(menu.querySelectorAll('a')).map(a => a.getAttribute('routerLink') ?? a.getAttribute('href'));

  it('offers registration and the dashboard to a signed-out visitor', () => {
    const menu = openMenu();
    const links = hrefs(menu);

    // A mechanic arriving for the first time has no account yet, so these
    // cannot be hidden behind sign-in.
    expect(links).withContext('no route to mechanic registration').toContain('/mechanic-signup');
    expect(links).toContain('/mechanic-dashboard');
    expect(links).toContain('/find-mechanic');
  });

  it('still offers them to a signed-in user who is not a seller or admin', () => {
    // The exact hole: a mechanic signs in and the menu shows them nothing of
    // their own, because every dashboard sat behind isSeller() || isAdmin().
    auth.currentUser.set({ id: 'u1', email: 'm@example.com', name: 'Mech', role: 'user' } as any);
    const links = hrefs(openMenu());

    expect(links).toContain('/mechanic-dashboard');
    expect(links).toContain('/mechanic-signup');
  });

  it('groups the links instead of stacking them', () => {
    // Thirteen identical bold lines is what "very unarranged" was describing.
    const menu = openMenu();
    const headings = Array.from(menu.querySelectorAll('.mm-head')).map(h => h.textContent!.trim());

    expect(headings.length).toBeGreaterThanOrEqual(3);
    expect(headings).toContain('Browse');
    expect(headings).toContain('Roadside help');
  });

  it('keeps the account buttons in the menu, not off the end of it', () => {
    const menu = openMenu();
    const cta = menu.querySelector('.mobile-btns');
    expect(cta).not.toBeNull();
    expect(cta!.textContent).toContain('Sign In');
  });

  it('shows the admin queue only to an admin', () => {
    let links = hrefs(openMenu());
    expect(links).not.toContain('/admin/mechanics');

    auth.currentUser.set({ id: 'a1', email: 'a@example.com', name: 'Admin', role: 'admin' } as any);
    fixture.detectChanges();
    links = hrefs(openMenu());
    expect(links).toContain('/admin/mechanics');
  });
});
