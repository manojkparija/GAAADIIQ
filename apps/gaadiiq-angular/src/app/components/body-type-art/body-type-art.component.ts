import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/** The six categories the cards offer. Exported so the page's data table is
 *  checked against it rather than against `string`, which is how a typo in a
 *  shape name would otherwise render an empty card. */
export type BodyShape =
  'hatchback' | 'sedan' | 'suv' | 'muv' | 'electric' | 'luxury';

/**
 * The six body types drawn large, for the "Browse by Body Type" cards.
 *
 * WHY A SECOND COMPONENT RATHER THAN SCALING THE FIRST
 *
 * app-body-type-icon is a 28x28 line glyph on a 1.6 stroke. It is right where
 * it is used — the hero filter pills, at roughly 1em — and it does not survive
 * being blown up: at card size the stroke goes spindly and the shapes read as a
 * wireframe rather than a car. Measured on the live page before this existed,
 * the cards rendered those glyphs at 38px, which is where Hatchback and Sedan
 * stop being distinguishable from each other and so do SUV and MUV. That is the
 * complaint this answers.
 *
 * So the pills keep the line glyph and the cards get artwork. Two components,
 * because they are two different drawings for two different sizes, not one
 * drawing at two scales.
 *
 * WHY ILLUSTRATION AND NOT PHOTOGRAPHS
 *
 * Photographs of named cars were the original ask and were turned down on
 * licensing: manufacturer press images are copyrighted, and a *generated*
 * "Mercedes-Benz S-Class" is incorrect manufacturer branding by construction —
 * a plausible but wrong car wearing a real marque. These silhouettes carry no
 * marque at all, which is the only version of this that is honest at six
 * cards.
 *
 * HOW THE DRAWINGS ARE BUILT
 *
 * One 240x112 viewBox for all six, with a shared ground line at y=96 and wheels
 * on the same axis, so the six cars sit at a consistent height and scale beside
 * each other. Each is a side profile rather than a three-quarter view: in
 * profile the thing that separates a hatchback from a sedan — where the roof
 * meets the tail — is unambiguous, and at three-quarters it is mostly hidden by
 * the body.
 *
 * Colour comes from two CSS custom properties the caller sets, --veh-1 and
 * --veh-2, so each card can carry its own finish without six copies of the
 * geometry. Glass, wheels and the ground shadow are fixed tints that work
 * against any of them.
 */
@Component({
  selector: 'app-body-type-art',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; line-height: 0; }
    svg { width: 100%; height: auto; display: block; overflow: visible; }
  `],
  template: `
    <svg viewBox="0 0 240 112" fill="none" aria-hidden="true">
      <defs>
        <linearGradient [attr.id]="'bodyGrad-' + shape" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" [attr.stop-color]="'var(--veh-1)'" />
          <stop offset="1" [attr.stop-color]="'var(--veh-2)'" />
        </linearGradient>
        <linearGradient [attr.id]="'glassGrad-' + shape" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stop-color="#F8FBFF" stop-opacity="0.95" />
          <stop offset="1" stop-color="#C7D7EA" stop-opacity="0.85" />
        </linearGradient>
      </defs>

      <!-- Ground shadow. An ellipse rather than a drop-shadow filter: a filter
           re-rasterises on every hover frame when the card scales the art, and
           this is six of them on one screen. -->
      <ellipse cx="120" cy="99" rx="92" ry="7" fill="#0F172A" opacity="0.10" />

      @switch (shape) {
        @case ('hatchback') {
          <!-- THE DEFINING FEATURE IS THE ABSENCE OF A BOOT.
               The first version of this drew a roof that fell away into a tail
               running on past the cabin, and it was called out for exactly what
               it was: a small sedan. A hatchback's cabin runs almost to the
               back of the car and stops at a steep tailgate, so the rear wheel
               sits close to the tail with barely any overhang behind it. The
               body is also shorter overall than the sedan below — 158 units
               against 194 — because "compact" is a proportion, not a caption. -->
          <path d="M34 92 L34 74 Q35 65 45 62 L64 55 Q72 36 92 34 L162 34 Q176 35 182 44
                   L186 56 Q188 64 188 74 L188 92 Z"
                [attr.fill]="'url(#bodyGrad-' + shape + ')'" />
          <path d="M74 53 Q82 40 95 39 L116 39 L116 53 Z" [attr.fill]="'url(#glassGrad-' + shape + ')'" />
          <!-- One long side window ending in the raked tailgate glass, rather
               than a side window plus a separate rear screen over a boot. -->
          <path d="M124 39 L158 39 Q170 40 177 50 L124 53 Z" [attr.fill]="'url(#glassGrad-' + shape + ')'" />
        }

        @case ('sedan') {
          <!-- Three boxes: bonnet, cabin, a boot that steps down and runs on.
               Lower roof and a longer tail than the hatchback. -->
          <path d="M22 92 L22 74 Q23 66 33 63 L62 56 Q73 40 93 38 L140 38 Q157 39 166 52 L196 60
                   Q214 64 216 75 L216 92 Z"
                [attr.fill]="'url(#bodyGrad-' + shape + ')'" />
          <path d="M70 54 Q78 44 94 43 L116 43 L116 54 Z" [attr.fill]="'url(#glassGrad-' + shape + ')'" />
          <path d="M124 43 L138 43 Q152 44 159 53 L124 54 Z" [attr.fill]="'url(#glassGrad-' + shape + ')'" />
        }

        @case ('suv') {
          <!-- Tall, upright, square shoulders, the roof flat from A-pillar to
               tailgate, and visibly more air under it than the others. -->
          <path d="M26 84 L26 56 Q27 47 37 43 L56 36 Q64 20 86 18 L150 18 Q170 20 180 36 L200 44
                   Q214 49 214 58 L214 84 Z"
                [attr.fill]="'url(#bodyGrad-' + shape + ')'" />
          <path d="M64 34 Q72 24 88 23 L112 23 L112 34 Z" [attr.fill]="'url(#glassGrad-' + shape + ')'" />
          <path d="M120 23 L146 23 Q164 25 172 34 L120 34 Z" [attr.fill]="'url(#glassGrad-' + shape + ')'" />
          <!-- Roof rails: the cue that reads "SUV" even in thumbnail. -->
          <rect x="82" y="14" width="80" height="4" rx="2" fill="var(--veh-2)" opacity="0.85" />
        }

        @case ('muv') {
          <!-- One box. The roof runs flat the whole length and the tail is
               vertical — longest of the six, and the only one with three side
               windows. -->
          <path d="M20 92 L20 58 Q21 48 32 44 L46 38 Q52 16 76 14 L176 14 Q198 16 206 34 L214 44
                   Q220 50 220 60 L220 92 Z"
                [attr.fill]="'url(#bodyGrad-' + shape + ')'" />
          <path d="M54 40 Q60 22 78 21 L100 21 L100 40 Z" [attr.fill]="'url(#glassGrad-' + shape + ')'" />
          <path d="M108 21 L142 21 L142 40 L108 40 Z" [attr.fill]="'url(#glassGrad-' + shape + ')'" />
          <path d="M150 21 L174 21 Q192 23 199 40 L150 40 Z" [attr.fill]="'url(#glassGrad-' + shape + ')'" />
        }

        @case ('electric') {
          <!-- Smooth aero form, closed nose where a grille would be, one
               unbroken fastback curve from windscreen to tail. -->
          <path d="M26 92 L26 73 Q27 64 38 60 L66 50 Q80 34 102 32 L140 32 Q160 34 174 48 L198 58
                   Q212 63 212 74 L212 92 Z"
                [attr.fill]="'url(#bodyGrad-' + shape + ')'" />
          <path d="M76 48 Q86 37 104 36 L124 36 L124 48 Z" [attr.fill]="'url(#glassGrad-' + shape + ')'" />
          <path d="M132 36 L140 36 Q158 38 168 49 L132 48 Z" [attr.fill]="'url(#glassGrad-' + shape + ')'" />
          <!-- Charge port, the only mark that says electric rather than coupe. -->
          <circle cx="42" cy="70" r="5" fill="#FFFFFF" opacity="0.9" />
          <path d="M42.6 66.8 L39.8 71.2 H42 L41.4 74 L44.2 69.4 H42 Z" fill="var(--veh-1)" />
        }

        @case ('luxury') {
          <!-- Long bonnet, cabin pushed back, long rear overhang, lowest roof
               of the six. A waistline accent because on a saloon this size the
               chrome strip is most of the silhouette's character. -->
          <path d="M18 92 L18 75 Q19 66 30 63 L70 55 Q84 41 106 40 L148 40 Q166 41 176 53 L204 61
                   Q220 65 222 76 L222 92 Z"
                [attr.fill]="'url(#bodyGrad-' + shape + ')'" />
          <path d="M82 53 Q90 45 107 44 L128 44 L128 53 Z" [attr.fill]="'url(#glassGrad-' + shape + ')'" />
          <path d="M136 44 L146 44 Q161 45 169 54 L136 53 Z" [attr.fill]="'url(#glassGrad-' + shape + ')'" />
          <rect x="34" y="68" width="176" height="2.6" rx="1.3" fill="#FFFFFF" opacity="0.55" />
        }
      }

      <!-- Wheels last so the arches sit over the body, and on one axis across
           all six so the cars line up when the eye tracks along the row. -->
      <g [attr.transform]="shape === 'suv' || shape === 'muv' ? 'translate(0,-6)' : ''">
        <circle [attr.cx]="frontAxle" cy="88" r="14.5" fill="#111827" />
        <circle [attr.cx]="frontAxle" cy="88" r="7" fill="#E6EBF2" />
        <circle [attr.cx]="frontAxle" cy="88" r="2.8" fill="#9AA7B8" />
        <circle [attr.cx]="rearAxle" cy="88" r="14.5" fill="#111827" />
        <circle [attr.cx]="rearAxle" cy="88" r="7" fill="#E6EBF2" />
        <circle [attr.cx]="rearAxle" cy="88" r="2.8" fill="#9AA7B8" />
      </g>
    </svg>
  `,
})
export class BodyTypeArtComponent {
  @Input({ required: true }) shape!: BodyShape;

  /**
   * Wheelbase per body type. Not decoration: a hatchback with a limousine's
   * wheelbase stops being a hatchback, and these six are only tellable apart by
   * proportion once the badge and the colour are gone.
   */
  get frontAxle(): number {
    return { hatchback: 66, sedan: 58, suv: 62, muv: 56, electric: 60, luxury: 56 }[this.shape];
  }
  get rearAxle(): number {
    return { hatchback: 158, sedan: 182, suv: 178, muv: 186, electric: 180, luxury: 190 }[this.shape];
  }
}
