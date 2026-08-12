import { Directive, ElementRef, HostListener, Input } from '@angular/core';

/**
 * What to do when an <img> fails to load.
 *
 * This replaces thirteen inline `onerror="…"` attributes spread across seven
 * templates. They worked, but an inline event handler is script in an
 * attribute, which a Content-Security-Policy has to allow with
 * `script-src 'unsafe-inline'` — and that single allowance is most of what a
 * CSP is for. Thirteen small conveniences were holding the policy open.
 *
 * Angular event bindings compile to real listeners, so this needs no such
 * allowance.
 *
 *   <img [src]="url" imgFallback>                     placeholder car image
 *   <img [src]="logo" imgFallback="hide">             fade out instead
 *   <img [src]="url" imgFallback="https://…/x.png">   a specific replacement
 */
@Directive({
  selector: 'img[imgFallback]',
  standalone: true,
})
export class ImgFallbackDirective {
  @Input() imgFallback: string | '' = '';

  /**
   * A fallback that itself fails must not re-enter.
   *
   * The inline handlers each began `this.onerror=null` for exactly this
   * reason: without it, a missing placeholder means the error handler swaps in
   * a src that fails, which fires the handler again, forever.
   */
  private handled = false;

  private static readonly DEFAULT = 'assets/cars/placeholder.svg';

  constructor(private el: ElementRef<HTMLImageElement>) {}

  @HostListener('error')
  onError(): void {
    if (this.handled) return;
    this.handled = true;

    const img = this.el.nativeElement;
    if (this.imgFallback === 'hide') {
      // Brand logos and similar: an empty space reads better than a broken
      // icon, and the layout already reserves the box.
      img.style.opacity = '0';
      return;
    }
    img.src = this.imgFallback || ImgFallbackDirective.DEFAULT;
  }
}
