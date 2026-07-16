import { Directive, ElementRef, OnInit, OnDestroy, Input } from '@angular/core';

@Directive({
  selector: '[appScrollAnimate]',
  standalone: true
})
export class ScrollAnimateDirective implements OnInit, OnDestroy {
  @Input() animationDelay = '0ms';
  private observer!: IntersectionObserver;

  constructor(private el: ElementRef) {}

  ngOnInit() {
    const native = this.el.nativeElement as HTMLElement;
    native.style.opacity = '0';
    native.style.transform = 'translateY(40px)';
    native.style.transition = `opacity 0.7s ease ${this.animationDelay}, transform 0.7s ease ${this.animationDelay}`;

    this.observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          native.style.opacity = '1';
          native.style.transform = 'translateY(0)';
          this.observer.unobserve(native);
        }
      });
    }, { threshold: 0.15 });

    this.observer.observe(native);
  }

  ngOnDestroy() { this.observer?.disconnect(); }
}
