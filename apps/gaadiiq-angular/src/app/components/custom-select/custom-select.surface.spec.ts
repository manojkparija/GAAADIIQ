/**
 * A page that puts this control on its own surface keeps it there, in both themes.
 *
 * WHAT WAS REPORTED
 *
 * /used-cars in dark mode: the Make and Max Budget selects rendered as black
 * boxes on the hero's blue-teal gradient, while City and Model — plain text
 * inputs immediately beside them — stayed translucent white.
 *
 * WHY
 *
 * The page asked, through ::ng-deep, and lost. Angular compiles
 *
 *     .search-select ::ng-deep .cs-trigger      ->  .search-select[_ngcontent-a] .cs-trigger
 *     :host-context([data-theme="dark"]) .cs-trigger
 *                                               ->  [data-theme="dark"] .cs-trigger[_ngcontent-b]
 *
 * Both are one class plus one attribute plus one class: the SAME specificity.
 * Ties are broken by source order, and the component's own stylesheet ships
 * after the page's, so the dark rule won and painted --nav-panel over the
 * translucent white the hero had asked for.
 *
 * It only showed in dark, because only the dark arm re-states the background.
 *
 * THE FIX THESE PIN
 *
 * --cs-bg / --cs-border / --cs-color / --cs-placeholder, following the
 * --cs-min-h and --cs-pad already on this component for exactly this purpose:
 * "a page can now state the height its other controls are without reaching
 * inside the component with ::ng-deep". A custom property inherits, so it
 * never enters the specificity contest at all.
 *
 * The dark-mode assertion is the one that matters. The light one passes on the
 * broken code too, and that asymmetry is the whole shape of the bug.
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';

import { CustomSelectComponent } from './custom-select.component';

/** A host that dresses the control the way the Used Cars hero does. */
@Component({
  standalone: true,
  imports: [CustomSelectComponent, FormsModule],
  template: `
    <app-custom-select class="on-gradient" [options]="opts" placeholder="All Makes" />
    <app-custom-select class="plain" [options]="opts" placeholder="All Makes" />
  `,
  styles: [`
    .on-gradient {
      --cs-bg: rgb(10, 20, 30);
      --cs-border: rgb(40, 50, 60);
      --cs-color: rgb(255, 255, 255);
    }
  `],
})
class HostComponent {
  opts = [{ value: 'a', label: 'A' }];
}

let host: HTMLElement | null = null;

function render(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);

  // Attached to the document deliberately: getComputedStyle resolves a custom
  // property against the element's ancestors, and :host-context() needs a real
  // ancestor chain up to <html>. A detached fixture has neither, so every
  // measurement would come back empty while appearing to pass.
  host = fixture.nativeElement as HTMLElement;
  document.body.appendChild(host);
  fixture.detectChanges();

  const trigger = (sel: string) =>
    host!.querySelector<HTMLElement>(`${sel} .cs-trigger`)!;

  return { dressed: trigger('.on-gradient'), plain: trigger('.plain') };
}

describe('CustomSelectComponent — a page can own the control’s surface', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    host?.remove();
    host = null;
  });

  it('honours --cs-bg in DARK mode', () => {
    // THE REPORTED BUG. Before the fix this measured --nav-panel, because the
    // dark rule re-stated `background` and won the tie on source order.
    const { dressed } = render('dark');

    expect(getComputedStyle(dressed).backgroundColor).toBe('rgb(10, 20, 30)');
  });

  it('honours --cs-bg in light mode too', () => {
    // Passes on the broken code as well. Kept because a fix that only worked
    // in dark would be its own bug, and because this is the half that proves
    // the variable is wired at all.
    const { dressed } = render('light');

    expect(getComputedStyle(dressed).backgroundColor).toBe('rgb(10, 20, 30)');
  });

  it('honours --cs-color and --cs-border in dark mode', () => {
    const { dressed } = render('dark');
    const style = getComputedStyle(dressed);

    expect(style.color).toBe('rgb(255, 255, 255)');
    expect(style.borderTopColor).toBe('rgb(40, 50, 60)');
  });

  it('leaves a control that sets nothing on the theme’s own colours', () => {
    // THE ONE THAT PROTECTS EVERY OTHER PAGE. These variables must be opt-in:
    // the four pages already setting --cs-min-h, and every plain usage, must
    // keep following the theme exactly as before.
    const { plain } = render('dark');
    const bg = getComputedStyle(plain).backgroundColor;

    expect(bg).not.toBe('rgb(10, 20, 30)');
    // The dark panel, not the light default — i.e. the dark arm still applies
    // where no page has overridden it.
    expect(bg).not.toBe('rgb(255, 255, 255)');
  });

  it('still follows the theme in light mode when nothing is set', () => {
    const { plain } = render('light');

    expect(getComputedStyle(plain).backgroundColor).toBe('rgb(255, 255, 255)');
  });
});
