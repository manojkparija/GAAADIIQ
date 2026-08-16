import { Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * The little square beside a lender's name.
 *
 * The rate table on Car Loan listed eleven lenders as bare text, so nothing
 * told one row from the next at a glance. The EMI calculator already put a
 * symbol beside each bank — emoji, which worked for five banks and does not
 * extend: there is no emoji for Cholamandalam, and the ones in use (💳, 🔵, 🟠)
 * were arbitrary anyway and render differently on every OS. This draws a
 * monogram instead, so every lender gets one and both pages match.
 *
 * `logo_url` is used when the API has one. It is null for every partner today,
 * which is why the monogram is the case that had to be right rather than the
 * fallback nobody sees.
 */

/** Words that carry no identity — "Bank of Baroda" should not initialise to BOB. */
const NOISE = new Set(['of', 'and', 'the', 'ltd', 'limited', 'pvt', 'private', '&']);

/**
 * Six pairs, cycled by name.
 *
 * Opaque backgrounds, not tints of the ink over whatever is behind. The first
 * version used `rgba(…, 0.12)` with the `--*-ink` tokens, which is the right
 * pattern for text on a page but wrong here: on Car Loan the mark sits on a
 * white card and measured 4.9:1, and on the EMI calculator the identical mark
 * sits on a glass panel, composited to #d1daee and measured 3.97:1. The same
 * badge passed on one page and failed on the other.
 *
 * Each pair is fixed rather than tokenised for the same reason the badge is
 * opaque: it is its own small surface, so it must not follow the theme onto a
 * background it was never measured against. Ratios on their own backgrounds:
 * 6.4, 5.9, 5.8, 5.4, 5.3, 6.6.
 */
const PALETTE = [
  { tint: '#E8EDFB', ink: '#1D4ED8' },
  { tint: '#DFF5F1', ink: '#0F766E' },
  { tint: '#E3F5EA', ink: '#047857' },
  { tint: '#FDF0DC', ink: '#B45309' },
  { tint: '#E4F2FC', ink: '#0369A1' },
  { tint: '#EFE6FC', ink: '#6D28D9' },
];

export function lenderInitials(name: string): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';

  // A bank that already goes by an acronym keeps it: HDFC, ICICI, HDB. Anything
  // longer than five is a word in capitals, not an acronym.
  const first = words[0];
  if (/^[A-Z]{2,5}$/.test(first)) return first;

  const significant = words.filter(w => !NOISE.has(w.toLowerCase()));
  return significant
    .slice(0, 3)
    .map(w => w[0].toUpperCase())
    .join('');
}

@Component({
  selector: 'app-lender-mark',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (logoUrl && !imageFailed()) {
      <img
        class="lm-logo"
        [src]="logoUrl"
        [alt]="name"
        loading="lazy"
        (error)="imageFailed.set(true)"
      />
    } @else {
      <span
        class="lm-mark"
        [class.lm-long]="initials().length > 3"
        [style.background]="colours().tint"
        [style.color]="colours().ink"
        aria-hidden="true"
      >{{ initials() }}</span>
    }
  `,
  styleUrl: './lender-mark.component.scss',
})
export class LenderMarkComponent {
  @Input({ required: true }) name = '';
  @Input() logoUrl: string | null = null;

  readonly imageFailed = signal(false);

  // Methods, not computed(). `name` is a plain @Input, not a signal, and
  // computed() tracks signal reads only — as a computed these would evaluate
  // against the first lender bound and then report that answer for every row.
  initials(): string {
    return lenderInitials(this.name);
  }

  colours(): { tint: string; ink: string } {
    // Deterministic, so a lender keeps its colour between visits and between
    // the two pages that draw it.
    let hash = 0;
    for (const ch of this.name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return PALETTE[hash % PALETTE.length];
  }
}
