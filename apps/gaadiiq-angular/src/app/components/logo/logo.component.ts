import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * The GAADIIQ wordmark.
 *
 * One component rather than two copies: the navbar and footer previously each
 * carried their own inline SVG, which is how a logo quietly ends up different
 * in two places.
 *
 * ## Design notes
 *
 * **Weight is the premium lever.** The previous mark was Arial Black at weight
 * 900 with negative tracking — the register of a discount retailer. This sets
 * the wordmark at 600 with wide positive tracking, which is where luxury
 * automotive marques sit.
 *
 * **Colour lives in the icon, not the letters.** A single solid navy wordmark
 * reproduces correctly everywhere a gradient cannot: a 16px favicon, a
 * one-colour print ad, embroidery on a partner mechanic's shirt. The blue arc
 * and teal arrow carry the brand colours and survive being shrunk.
 *
 * **The double-I is set as real letterforms.** It used to be two rounded bars,
 * which read as a pause icon and invited misreadings of the name — GAADILQ,
 * GAADIIO — and, worse, mistyped domains.
 */
@Component({
  selector: 'app-logo',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg
      class="brand-logo"
      [attr.width]="width"
      [attr.height]="height"
      viewBox="0 0 168 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="GAADIIQ"
    >
      <!-- Icon: an open arc reading as G, with a teal arrow leaving through the
           gap. Motion and intelligence without resorting to a car silhouette. -->
      <circle
        cx="18" cy="18" r="11"
        stroke="#2F6BFF" stroke-width="4.5" fill="none"
        stroke-dasharray="55.3 69.1" stroke-dashoffset="-7.5" stroke-linecap="round"
      />
      <line x1="18" y1="18" x2="29" y2="18" stroke="#14B8A6" stroke-width="4.5" stroke-linecap="round" />
      <polyline
        points="25.5,14.5 29,18 25.5,21.5"
        stroke="#14B8A6" stroke-width="3"
        stroke-linecap="round" stroke-linejoin="round" fill="none"
      />

      <!-- Wordmark. Outfit is the site's heading face; the fallbacks matter
           because the logo must not silently drop to a different personality
           on a cold load. -->
      <text
        class="brand-logo__word"
        x="41" y="25"
        font-family="'Outfit','Manrope','Helvetica Neue',Arial,sans-serif"
        font-weight="600" font-size="21" letter-spacing="1.6"
      >GAADIIQ</text>
    </svg>
  `,
  styles: [`
    .brand-logo { display: block; }

    /* Navy in light mode. The token would go near-black, which loses the brand
       tie; this is deliberately a fixed brand colour, not --text. */
    .brand-logo__word { fill: #1E3A8A; }

    /* #1E3A8A on the dark canvas is close to invisible, so the dark theme takes
       a lighter blue rather than the same value. */
    :host-context([data-theme='dark']) .brand-logo__word { fill: #93B4FF; }

    @media (prefers-color-scheme: dark) {
      :host-context(:not([data-theme='light'])) .brand-logo__word { fill: #93B4FF; }
    }
  `],
})
export class LogoComponent {
  @Input() width = 196;
  @Input() height = 42;
}
