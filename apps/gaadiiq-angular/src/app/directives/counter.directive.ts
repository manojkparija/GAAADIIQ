import { Directive, ElementRef, Input, OnInit, OnDestroy } from '@angular/core';

@Directive({
  selector: '[appCounter]',
  standalone: true
})
export class CounterDirective implements OnInit, OnDestroy {
  @Input('appCounter') target = 0;
  @Input() counterDecimal = false;
  @Input() counterSuffix = '';
  @Input() counterDuration = 2000;
  private observer!: IntersectionObserver;
  private animated = false;

  constructor(private el: ElementRef) {}

  ngOnInit() {
    this.observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting && !this.animated) {
          this.animated = true;
          this.animate();
          this.observer.unobserve(this.el.nativeElement);
        }
      });
    }, { threshold: 0.5 });
    this.observer.observe(this.el.nativeElement);
  }

  animate() {
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / this.counterDuration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      const val = this.counterDecimal
        ? Math.round(this.target * ease * 10) / 10
        : Math.round(this.target * ease);
      this.el.nativeElement.textContent = val + this.counterSuffix;
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  ngOnDestroy() { this.observer?.disconnect(); }
}
