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

/**
 * The account menu behind the avatar.
 *
 * Reported as "so many options are here, please analyse and rearrange": it was
 * a flat list of fourteen rows mixing personal settings with site-wide admin
 * tools. Rearranging it surfaced two faults worth pinning down, because both
 * are the kind that reappear when someone adds the next menu entry.
 */
describe('NavbarComponent account menu', () => {
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

  const signIn = (role: string) => {
    auth.currentUser.set({ id: 'u1', email: 'u@example.com', name: 'User', role } as any);
    fixture.detectChanges();
  };

  /** Open the avatar dropdown and hand it back. */
  const openAccount = (): HTMLElement => {
    component.userMenuOpen.set(true);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('.user-dropdown') as HTMLElement;
  };

  const routes = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('a')).map(a => a.getAttribute('routerLink') ?? a.getAttribute('href'));

  it('never lists the same page twice', () => {
    // /list-car appeared as both "List Your Car" and "Sell My Car" — one page
    // under two names, which reads as two different features.
    for (const role of ['customer', 'seller', 'admin']) {
      signIn(role);
      const links = routes(openAccount()).filter(Boolean) as string[];
      const seen = links.filter((r, i) => links.indexOf(r) !== i);
      expect(seen).withContext(`${role} sees a duplicated route: ${seen.join(', ')}`).toEqual([]);
    }
  });

  it('still gives every signed-in role a way to list a car', () => {
    // The de-duplication must not remove the entry point along with the copy.
    for (const role of ['customer', 'seller', 'admin']) {
      signIn(role);
      expect(routes(openAccount())).withContext(role).toContain('/list-car');
    }
  });

  it('groups the seller and admin tools under headings', () => {
    signIn('admin');
    const headings = Array.from(openAccount().querySelectorAll('.dropdown-group'))
      .map(h => h.textContent!.trim());
    expect(headings).toEqual(['Selling', 'Admin']);
  });

  it('shows a plain customer no headings at all', () => {
    // Three rows need no signposting; headings over a short list are noise.
    signIn('customer');
    const menu = openAccount();
    expect(menu.querySelectorAll('.dropdown-group').length).toBe(0);
    expect(routes(menu)).not.toContain('/analytics');
  });

  it('reaches the same pages on a phone as on the desktop', () => {
    // The mobile menu had drifted: My Profile, Notifications, Leads and
    // Analytics existed only in the desktop dropdown, so on a phone those four
    // pages could not be opened at all.
    signIn('admin');
    const desktop = new Set(routes(openAccount()).filter(Boolean) as string[]);

    component.menuOpen.set(true);
    fixture.detectChanges();
    const mobile = new Set(
      routes(fixture.nativeElement.querySelector('.mobile-menu')).filter(Boolean) as string[],
    );

    const missing = [...desktop].filter(r => !mobile.has(r));
    expect(missing).withContext(`unreachable on a phone: ${missing.join(', ')}`).toEqual([]);
  });
});
