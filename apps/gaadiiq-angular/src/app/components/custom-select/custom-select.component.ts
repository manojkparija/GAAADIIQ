import { Component, Input, Output, EventEmitter, signal, HostListener, ElementRef, forwardRef } from '@angular/core';
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
export class CustomSelectComponent implements ControlValueAccessor {
  /**
   * Plain strings when the label is the value, which is most of the time.
   * `{value, label}` when they differ.
   */
  @Input() options: (string | SelectOption)[] = [];
  @Input() placeholder = 'Select...';
  @Input() disabled = false;

  value = signal('');
  open = signal(false);

  private onChange: (v: string) => void = () => {};
  private onTouched: () => void = () => {};

  constructor(private el: ElementRef) {}

  writeValue(v: string) { this.value.set(v ?? ''); }
  registerOnChange(fn: (v: string) => void) { this.onChange = fn; }
  registerOnTouched(fn: () => void) { this.onTouched = fn; }
  setDisabledState(d: boolean) { this.disabled = d; }

  toggle() {
    if (this.disabled) return;
    this.open.update(o => !o);
    this.onTouched();
  }

  select(opt: string | SelectOption) {
    const v = this.valueOf(opt);
    this.value.set(v);
    this.onChange(v);
    this.open.set(false);
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

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent) {
    if (!this.el.nativeElement.contains(e.target)) {
      this.open.set(false);
    }
  }
}
