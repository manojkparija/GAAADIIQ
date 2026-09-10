/**
 * Choosing something from a menu closes the menu.
 *
 * WHAT WAS REPORTED
 *
 * "Many times when clicking Maruti Suzuki the page is still there — then we
 * need to click outside." The New Cars mega-menu stayed open on top of the
 * page it had just navigated to.
 *
 * WHY IT HAPPENED, AND WHY IT LOOKED INTERMITTENT
 *
 * Closing was left entirely to the router: the constructor subscribes to
 * NavigationEnd and calls closeOthers('none'). That covers the ordinary case
 * and misses the one people actually hit — choosing the entry you are already
 * on. Clicking "Maruti Suzuki" while on /new-cars?make=Maruti%20Suzuki
 * resolves to the URL already in the bar, so the router declines to navigate,
 * emits no NavigationEnd, and nothing tells the panel to close.
 *
 * That is exactly why it read as "many times" rather than always: the first
 * click from another page worked, and every repeat of the same choice did not.
 * It also explains why clicking outside fixed it — the document:click handler
 * only closes when the click landed OUTSIDE .nav-dropdown, and a menu chip is
 * inside it.
 *
 * The tests below drive the handler rather than the router, because a test
 * that navigates would reproduce the working case and miss the reported one.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { NavbarComponent } from './navbar.component';

function mount(): NavbarComponent {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [NavbarComponent, RouterTestingModule],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return TestBed.createComponent(NavbarComponent).componentInstance;
}

/** A click whose target is the given element. */
function clickOn(el: Element): Event {
  const event = new MouseEvent('click', { bubbles: true });
  Object.defineProperty(event, 'target', { value: el });
  return event;
}

function chip(): HTMLAnchorElement {
  const panel = document.createElement('div');
  panel.className = 'nav-mega';
  const link = document.createElement('a');
  link.className = 'nav-menu-chip';
  link.textContent = 'Maruti Suzuki';
  panel.appendChild(link);
  return link;
}

describe('NavbarComponent — a menu closes when you choose from it', () => {
  it('closes when the chosen entry is the page you are already on', () => {
    // THE REPORTED CASE. No navigation happens, so nothing the router emits
    // can help — and this is the click people repeat.
    const c = mount();
    c.newCarsOpen.set(true);

    c.onMenuLinkClick(clickOn(chip()));

    expect(c.newCarsOpen()).toBeFalse();
  });

  it('closes whichever menu was open', () => {
    // One handler on the panel rather than a click binding on each of the
    // twenty-odd links, so entries added later are covered too.
    const c = mount();

    for (const open of [c.usedCarsOpen, c.financeOpen, c.insuranceOpen, c.moreOpen]) {
      open.set(true);
      c.onMenuLinkClick(clickOn(chip()));
      expect(open()).toBeFalse();
    }
  });

  it('closes when the click lands on something inside the link', () => {
    // Several entries wrap an <app-icon> and a label, so the click target is
    // routinely a child of the anchor rather than the anchor itself.
    const c = mount();
    c.newCarsOpen.set(true);
    const link = chip();
    const icon = document.createElement('span');
    link.appendChild(icon);

    c.onMenuLinkClick(clickOn(icon));

    expect(c.newCarsOpen()).toBeFalse();
  });

  it('leaves the menu open when the click was not a choice', () => {
    // A heading or the panel's own padding is not a selection. Closing on
    // those would make the menu feel like it dismisses itself at random.
    const c = mount();
    c.newCarsOpen.set(true);
    const heading = document.createElement('div');
    heading.className = 'nav-mega-head';
    const panel = document.createElement('div');
    panel.className = 'nav-mega';
    panel.appendChild(heading);

    c.onMenuLinkClick(clickOn(heading));

    expect(c.newCarsOpen()).toBeTrue();
  });
});
