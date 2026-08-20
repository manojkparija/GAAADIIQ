import { Component, Input, Output, EventEmitter, signal, HostListener, ElementRef, forwardRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * An option that shows one thing and stores another — a variant whose label
 * carries its price, for instance.
 */
export interface SelectOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-custom-select',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './custom-select.component.html',
  styleUrl: './custom-select.component.scss',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CustomSelectComponent), multi: true }],
})
export class CustomSelectComponent implements ControlValueAccessor, OnDestroy {
  /**
   * Plain strings when the label is the value, which is most of the time.
   * `{value, label}` when they differ.
   */
  @Input() options: (string | SelectOption)[] = [];
  @Input() placeholder = 'Select...';
  @Input() disabled = false;

  value = signal('');
  open = signal(false);

  /**
   * Where the open list is painted, in viewport coordinates.
   *
   * The list used to be positioned against this component, which meant any
   * ancestor that clipped its overflow cut it off. That is not a rare
   * arrangement — measured across the app, a hero with `overflow: hidden`
   * holding a search bar, two pages clipping decorative orbs the same way,
   * and a sticky filter sidebar that genuinely has to scroll. The Max Budget
   * list lost every option below the first; the valuation page's Make list
   * lost twelve of seventeen.
   *
   * The list is now painted fixed *and* parked on <body> while open — see
   * `parked` for why fixed alone was not enough. Together they leave pages
   * free to clip their own contents without having to know that a dropdown
   * might open inside them.
   */
  dropdownStyle = signal<Record<string, string>>({});

  /** The last left/top actually written, so the next pass can see how far off it landed. */
  private applied: { x: number; y: number } | null = null;

  /**
   * The open list, while it is parked on <body>.
   *
   * Fixed positioning alone was not enough, and it is worth being precise
   * about why, because it looked like it had worked: a fixed element escapes
   * an ancestor's `overflow: hidden` only while no ancestor establishes its
   * containing block. Several of these cards animate in, and a transform does
   * establish one — so the list stayed clipped by the hero exactly as before,
   * while every coordinate measured correct. Moving the node out of the
   * subtree is what actually escapes the clip.
   */
  private parked: HTMLElement | null = null;

  /** Matches max-height on .cs-dropdown. */
  private static readonly MAX_H = 260;
  /** Keeps the list off the very edge of the window. */
  private static readonly EDGE = 8;
  /** Distance between the trigger and the list. */
  private static readonly GAP = 6;

  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  // Capture, so that scrolling *any* ancestor — the filter sidebar, not just
  // the window — keeps the list attached to its trigger rather than leaving
  // it stranded mid-page.
  private readonly reflow = () => { if (this.open()) this.position(); };

  constructor(private el: ElementRef) {
    window.addEventListener('scroll', this.reflow, true);
    window.addEventListener('resize', this.reflow);
    // Several of these cards animate in, so a list opened during that
    // animation is measured against a trigger still on its way — the gap came
    // out anywhere between 2px and 10px instead of 6px. Re-placing when the
    // movement ends settles it.
    document.addEventListener('transitionend', this.reflow, true);
    document.addEventListener('animationend', this.reflow, true);
  }

  ngOnDestroy() {
    window.removeEventListener('scroll', this.reflow, true);
    window.removeEventListener('resize', this.reflow);
    document.removeEventListener('transitionend', this.reflow, true);
    document.removeEventListener('animationend', this.reflow, true);
    // A component torn down while its list is open would otherwise leave the
    // list behind on <body>, with nothing left to close it.
    this.unpark();
  }

  /**
   * Fixed coordinates are viewport coordinates only when no ancestor has a
   * transform. Several here do — the hero search card and the loan form both
   * animate in — and a transformed ancestor becomes the containing block for
   * anything fixed inside it, so the same numbers land somewhere else
   * entirely. Measured, that put the Max Budget list 200px below its trigger
   * and the loan list off the top of the window, behind the navbar.
   *
   * Rather than hunt for which ancestor did it, this asks for a position,
   * looks at where the list actually landed, and corrects by the difference.
   * That works whatever caused the shift — transform today, `filter` or
   * `contain` in some future stylesheet — and needs no cooperation from the
   * page.
   *
   * First pass is hidden, so the correction never appears as a jump.
   */
  private place(firstPass: boolean) {
    const trigger = this.el.nativeElement.querySelector('.cs-trigger') as HTMLElement | null;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const { EDGE, GAP, MAX_H } = CustomSelectComponent;

    const style: Record<string, string> = {
      position: 'fixed',
      left: `${Math.round(r.left)}px`,
      width: `${Math.round(r.width)}px`,
    };

    if (firstPass) {
      // Nothing is known about the list's height yet, so park it below the
      // trigger, out of sight, purely to be measured.
      this.applied = { x: Math.round(r.left), y: Math.round(r.bottom + GAP) };
      this.dropdownStyle.set({
        ...style,
        top: `${this.applied.y}px`,
        'max-height': `${MAX_H}px`,
        visibility: 'hidden',
      });
      return;
    }

    // Once parked it is no longer a descendant of this component, so it has to
    // be reached through the reference rather than looked up.
    const list = this.parked
      ?? (this.el.nativeElement.querySelector('.cs-dropdown') as HTMLElement | null);
    if (!list || !this.applied) return;

    // How far off the last write landed. Re-derived every time rather than
    // remembered: the containing block is itself inside the page, so it moves
    // when anything scrolls. Caching this was wrong — measured, the list
    // stopped following its trigger by 118px once the filter sidebar
    // scrolled, and refused to flip near the bottom of the window.
    const actual = list.getBoundingClientRect();
    const shiftX = actual.left - this.applied.x;
    const shiftY = actual.top - this.applied.y;

    // The real height is known now, so opening upwards is decided on what the
    // list actually is rather than on a guess made before it existed.
    const h = Math.min(list.scrollHeight, MAX_H);
    const roomBelow = window.innerHeight - r.bottom - GAP - EDGE;
    const roomAbove = r.top - GAP - EDGE;
    const flip = h > roomBelow && roomAbove > roomBelow;

    const maxH = Math.max(120, Math.min(MAX_H, flip ? roomAbove : roomBelow));
    const top = flip ? r.top - GAP - Math.min(h, maxH) : r.bottom + GAP;

    this.applied = { x: Math.round(r.left - shiftX), y: Math.round(top - shiftY) };
    this.dropdownStyle.set({
      ...style,
      left: `${this.applied.x}px`,
      top: `${this.applied.y}px`,
      'max-height': `${Math.round(maxH)}px`,
    });
  }

  private position() {
    this.place(false);
  }

  writeValue(v: string) { this.value.set(v ?? ''); }
  registerOnChange(fn: (v: string) => void) { this.onChange = fn; }
  registerOnTouched(fn: () => void) { this.onTouched = fn; }
  setDisabledState(d: boolean) { this.disabled = d; }

  toggle() {
    if (this.disabled) return;
    if (this.open()) { this.close(); return; }

    this.place(true);
    this.open.set(true);
    this.onTouched();
    // The list does not exist until Angular has rendered it, so parking and
    // measuring it both have to wait for that frame.
    requestAnimationFrame(() => {
      if (!this.open()) return;
      this.park();
      this.place(false);
    });
  }

  /** Move the rendered list onto <body>, out of every clipping ancestor. */
  private park() {
    const list = this.el.nativeElement.querySelector('.cs-dropdown') as HTMLElement | null;
    if (!list || this.parked) return;
    this.parked = list;
    document.body.appendChild(list);
  }

  /**
   * Put it back before Angular removes it.
   *
   * Angular still believes the node lives in this component's view and will
   * remove it from that parent when @if goes false. Returning it first keeps
   * those two views of the DOM in agreement.
   */
  private unpark() {
    if (!this.parked) return;
    const wrap = this.el.nativeElement.querySelector('.cs-wrap');
    if (wrap) wrap.appendChild(this.parked);
    else this.parked.remove();
    this.parked = null;
  }

  private close() {
    this.unpark();
    this.open.set(false);
  }

  select(opt: string | SelectOption) {
    const v = this.valueOf(opt);
    this.value.set(v);
    this.onChange(v);
    this.close();
  }

  valueOf(opt: string | SelectOption): string {
    return typeof opt === 'string' ? opt : opt.value;
  }

  labelOf(opt: string | SelectOption): string {
    return typeof opt === 'string' ? opt : opt.label;
  }

  get displayValue(): string {
    // The stored value is not always what the user picked off the list, so the
    // trigger has to look the label back up rather than print the value.
    const current = this.value();
    if (!current) return this.placeholder;
    const match = this.options.find(o => this.valueOf(o) === current);
    return match ? this.labelOf(match) : current;
  }

  // Escape closed nothing before this: the only way out of an open list was to
  // click elsewhere or pick something, which for a keyboard user meant the
  // list could not be dismissed at all.
  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.open()) this.close();
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent) {
    const target = e.target as Node;
    // The open list is no longer a descendant of this component — it is on
    // <body> — so "inside" has to mean either of the two places it can be,
    // otherwise clicking the list's own scrollbar dismisses it.
    const inside =
      this.el.nativeElement.contains(target) || !!this.parked?.contains(target);
    if (!inside) this.close();
  }
}
