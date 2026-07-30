import { Component, Input, Output, EventEmitter, signal, HostListener, ElementRef, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'app-custom-select',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './custom-select.component.html',
  styleUrl: './custom-select.component.scss',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CustomSelectComponent), multi: true }],
})
export class CustomSelectComponent implements ControlValueAccessor {
  @Input() options: string[] = [];
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

  select(opt: string) {
    this.value.set(opt);
    this.onChange(opt);
    this.open.set(false);
  }

  get displayValue(): string {
    return this.value() || this.placeholder;
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent) {
    if (!this.el.nativeElement.contains(e.target)) {
      this.open.set(false);
    }
  }
}
