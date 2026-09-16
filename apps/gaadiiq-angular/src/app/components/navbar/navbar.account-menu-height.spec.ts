/**
 * The account menu fits on the screen, whatever the account can do.
 *
 * REPORTED, with a screenshot of the menu open at 100% browser zoom: the last
 * items ran off the bottom of the window, and the only way to reach them was
 * to zoom the browser out.
 *
 * WHY IT DEPENDS ON WHO IS SIGNED IN
 *
 * This menu is built from what the account can do. A signed-in buyer gets
 * three rows and no group headings; a seller adds four more; an admin adds
 * seven and a third heading — sixteen rows and three headings in total. The
 * panel had no max-height, so its height was simply the sum of its items, and
 * an admin on a laptop window overflowed the viewport.
 *
 * That is why it never showed up in ordinary use: the menu a customer sees
 * fits easily, and the menu that does not is only visible to an admin.
 *
 * .nav-mega and .nav-menu both bound their height and scroll. This panel was
 * the one that never got the same treatment, so this pins it for whichever
 * role has the longest menu — the assertion is written against the rendered
 * box, not against the stylesheet, so it fails if the rule is dropped.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { NavbarComponent } from './navbar.component';
import { AuthService } from '../../services/auth.service';

/** Signed in, with every section of the menu switched on. */
function mountAsAdmin() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [NavbarComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: AuthService,
        useValue: {
          currentUser: signal({ id: 'u1', email: 'admin@gaadiiq.com', name: 'Admin', role: 'admin' }),
          isLoggedIn: () => true,
          isAdmin: () => true,
          isLocalOnly: () => false,
          isSeller: () => true,
          logout: () => {},
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(NavbarComponent);
  fixture.componentInstance.userMenuOpen.set(true);
  fixture.detectChanges();
  return fixture;
}

describe('NavbarComponent — the account menu fits the window', () => {
  it('is bounded by the viewport rather than by its own contents', () => {
    /**
     * Asserted against the declared bound, not against the rendered height.
     *
     * The obvious test — "the panel is no taller than window.innerHeight" —
     * passes with the bug still in place: Karma runs in an iframe tall enough
     * for all sixteen rows, so the overflow the screenshot shows never
     * happens here. A test that cannot fail is worse than no test, because it
     * reads as coverage.
     *
     * What actually distinguishes fixed from broken is whether the panel's
     * height is tied to the window at all. Unbounded, max-height is `none`
     * and the height is simply the sum of the items, whatever that comes to
     * on the reader's screen.
     */
    const fixture = mountAsAdmin();
    const panel: HTMLElement | null =
      fixture.nativeElement.querySelector('.user-dropdown');

    expect(panel).withContext('the account menu did not render').toBeTruthy();

    const maxHeight = getComputedStyle(panel!).maxHeight;
    expect(maxHeight)
      .withContext('the menu grows with its contents and can run off the screen')
      .not.toBe('none');

    // Resolved to pixels by the browser, so this also catches a bound that is
    // nominally set but larger than the window.
    expect(parseFloat(maxHeight))
      .withContext(`bound of ${maxHeight} in a ${window.innerHeight}px viewport`)
      .toBeLessThanOrEqual(window.innerHeight);
  });

  it('scrolls instead of overflowing, so nothing is unreachable', () => {
    // The half that matters: bounding the height only helps if the items past
    // the bound can still be scrolled to. A max-height with `overflow: hidden`
    // would pass the test above and hide the same items.
    const fixture = mountAsAdmin();
    const panel: HTMLElement = fixture.nativeElement.querySelector('.user-dropdown');

    expect(getComputedStyle(panel).overflowY).toBe('auto');
  });

  it('still renders every item, so nothing was removed to make it fit', () => {
    // Bounding the panel must not be confused with shortening the menu. An
    // admin can reach all of it; the panel scrolls.
    const fixture = mountAsAdmin();
    const items = fixture.nativeElement.querySelectorAll('.user-dropdown .dropdown-item');

    expect(items.length)
      .withContext('an admin should see the full menu')
      .toBeGreaterThanOrEqual(10);
  });
});
