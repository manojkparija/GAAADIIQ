import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * The six body-type silhouettes, as inline SVG.
 *
 * These replaced emoji (🚗 🚘 🚙 🚐 ⚡ ✨), which is why the cards looked
 * ordinary. An emoji is drawn by the operating system's font: the same six
 * glyphs are flat pastel on Windows, glossy on macOS and outlined on Android,
 * so they can never be GAADIIQ's. The specific failure was worse than generic —
 * 🚗 and 🚘 are near-identical at small sizes on Windows, so Hatchback and Sedan
 * were not visually distinguishable at all.
 *
 * A component rather than markup in the page, because the icons appear twice on
 * /new-cars — the hero filter pills and the "Browse by Body Type" cards — and a
 * silhouette copied into two templates is a silhouette that gets fixed in one.
 *
 * Every icon is drawn on the same 28x28 grid at the same stroke weight and uses
 * `currentColor`, so size and colour are the caller's business: set font-size or
 * width/height and `color` on the host and the icon follows.
 */
@Component({
  selector: 'app-body-type-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: inline-flex; line-height: 0; }
    svg { width: 1em; height: 1em; display: block; }
  `],
  template: `
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.6"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      @switch (shape) {
        @case ('hatchback') {
          <!-- Short bonnet, roofline falling straight to the tail: the one
               profile cue that separates it from the sedan. -->
          <path d="M3 18h22M4.5 18v-3.2l2.6-4.6A2 2 0 0 1 8.9 9h8.4a2 2 0 0 1 1.5.7l4.1 4.6V18" />
          <path d="M11 9.2V14M4.6 14h18" />
          <circle cx="9" cy="19.6" r="2.2" /><circle cx="19" cy="19.6" r="2.2" />
        }
        @case ('sedan') {
          <!-- Three-box: bonnet, cabin, and a boot projecting past the rear glass. -->
          <path d="M2.5 18h23M4 18v-3.4l3-4.4A2 2 0 0 1 8.7 9.3h7.9a2 2 0 0 1 1.6.8l3 4.1 3.3.9V18" />
          <path d="M11.5 9.4V14M4.1 14h17.3" />
          <circle cx="8.5" cy="19.6" r="2.2" /><circle cx="19.5" cy="19.6" r="2.2" />
        }
        @case ('suv') {
          <!-- Tall, upright glasshouse and a near-vertical tailgate; the height
               and the squared-off rear are the cues, not roof rails. An earlier
               version drew rails as a second line just above the roof, and at
               2.4rem that read as a double roofline rather than as a rack. -->
          <path d="M3 17.6h22M4.5 17.6V10a2 2 0 0 1 2-2h12.9a2 2 0 0 1 1.6.8l2.5 3.5v5.3" />
          <path d="M11.6 8.2v5M4.6 13.3h18.8" />
          <circle cx="9" cy="19.4" r="2.3" /><circle cx="19" cy="19.4" r="2.3" />
        }
        @case ('muv') {
          <!-- One-box van profile: unbroken roof, three side windows. -->
          <path d="M3 17.6h22M4.5 17.6V9.4a2 2 0 0 1 2-2h12.4a2 2 0 0 1 1.6.8l3 4.2v5.2" />
          <path d="M9.6 7.6v5.6M15.2 7.6v5.6M4.6 13.2h18.9" />
          <circle cx="8.8" cy="19.4" r="2.3" /><circle cx="19.2" cy="19.4" r="2.3" />
        }
        @case ('electric') {
          <!-- A bolt above the car, not a bare bolt: it has to read as a body
               type alongside five silhouettes. -->
          <path d="M3 18.2h22M4.5 18.2v-3.4l2.8-4.5A2 2 0 0 1 9 9.3h8.2a2 2 0 0 1 1.6.8l3.7 4.7v3.4" />
          <path d="M4.6 14.6h18.2" />
          <circle cx="9" cy="20" r="2.2" /><circle cx="19" cy="20" r="2.2" />
          <path d="M14.4 2.6 11.6 6.9h2.9l-1 3.4 3.2-4.5h-3z" fill="currentColor" stroke="none" />
        }
        @case ('luxury') {
          <!-- Long bonnet, low fastback roof, small crown. -->
          <path d="M2.5 18.4h23M4 18.4v-3l3.4-4a2 2 0 0 1 1.5-.7h7.6a2 2 0 0 1 1.4.6l4.6 4.4v2.7" />
          <path d="M12.4 10.7v3.9M4.1 14.6h18.3" />
          <circle cx="8.6" cy="20" r="2.2" /><circle cx="19.4" cy="20" r="2.2" />
          <!-- A rhombus, not a crown. The five-point crown this replaced
               collapsed into an indistinct blob once drawn at 38px — a cut-gem
               diamond survives the size because it is four straight edges. -->
          <path d="M14 3 16.6 5.9 14 9.2 11.4 5.9z" fill="currentColor" stroke="none" />
        }
      }
    </svg>
  `,
})
export class BodyTypeIconComponent {
  /** One of: hatchback | sedan | suv | muv | electric | luxury. */
  @Input({ required: true }) shape!: string;
}
