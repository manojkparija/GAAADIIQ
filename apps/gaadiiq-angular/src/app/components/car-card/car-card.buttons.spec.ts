/**
 * The two buttons on a car card are the same size.
 *
 * Reported from the live site: "width of the two button is different". They
 * were — each was sized by its own content under its own rule (0.4rem/0.9rem
 * at 0.78rem for "View Details", 0.35rem/0.65rem at 0.75rem plus an icon for
 * "Review"), so the pair came out mismatched in width and, once "View Details"
 * wrapped onto two lines in the tight column, in height too.
 *
 * Measured rather than asserted on classes: equal width is a property of the
 * rendered box, and every version of this markup would have passed a class
 * check. Karma loads src/styles.scss, so .btn-gradient and the component rules
 * cascade exactly as they do on the page.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CarCardComponent } from './car-card.component';

describe('car card — action buttons', () => {
  let fixture: ComponentFixture<CarCardComponent>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CarCardComponent],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(CarCardComponent);
    fixture.componentInstance.car = {
      id: 'c1', make: 'Maruti Suzuki', model: 'Fronx', year: 2026,
      price: 930000, km: 0, fuel: 'Petrol', transmission: 'Manual',
      badge: 'Fair Price', badgeType: 'fair',
      image: 'assets/cars/placeholder.svg',
      rating: 0, reviews: 0, verified: true,
    } as any;
    fixture.detectChanges();
    // Rects are all zero on a detached fixture, so nothing below would mean
    // anything without this.
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  function buttons(): HTMLElement[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('.card-cta, .card-cta-sm'),
    );
  }

  it('renders both actions', () => {
    const labels = buttons().map(b => b.textContent?.trim());
    expect(labels.length).toBe(2);
    expect(labels.join(' | ')).toContain('Review');
    expect(labels.join(' | ')).toContain('View Details');
  });

  it('gives them the same width', () => {
    const widths = buttons().map(b => b.getBoundingClientRect().width);
    // Sub-pixel grid rounding is fine; a visible difference is not.
    expect(Math.abs(widths[0] - widths[1]))
      .withContext(`widths were ${widths.map(w => w.toFixed(1)).join(' and ')}`)
      .toBeLessThanOrEqual(1);
  });

  it('gives them the same height', () => {
    const heights = buttons().map(b => b.getBoundingClientRect().height);
    expect(Math.abs(heights[0] - heights[1]))
      .withContext(`heights were ${heights.map(h => h.toFixed(1)).join(' and ')}`)
      .toBeLessThanOrEqual(1);
  });

  it('keeps each label on one line', () => {
    // "View Details" wrapping is what made the heights differ in the first
    // place, so this pins the cause rather than only the symptom.
    for (const b of buttons()) {
      expect(getComputedStyle(b).whiteSpace)
        .withContext(`"${b.textContent?.trim()}" may wrap`)
        .toBe('nowrap');
    }
  });

  it('puts the blue-teal gradient on both', () => {
    for (const b of buttons()) {
      expect(b.classList.contains('btn-gradient'))
        .withContext(`"${b.textContent?.trim()}" is not gradient`).toBeTrue();
      expect(b.classList.contains('btn-outline'))
        .withContext(`"${b.textContent?.trim()}" is still outlined`).toBeFalse();
    }
  });
});

/**
 * The card quotes the published trims, not the catalogue row's own price.
 *
 * This is the third surface of one bug and the reason this suite exists: the
 * New Cars model card was fixed in #116, and the same car went on reading
 * "₹9.3L" here — from `car.price`, a hand-maintained figure that had drifted
 * from the trims — while the model card one tab away read "₹6.84L – ₹11.98L".
 * Fixing one view of a shared figure is not fixing the figure.
 */
describe('car card — price', () => {
  let fixture: ComponentFixture<CarCardComponent>;

  function render(over: Record<string, unknown>) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CarCardComponent],
      providers: [provideRouter([])],
    });
    fixture = TestBed.createComponent(CarCardComponent);
    fixture.componentInstance.car = {
      id: 'c1', make: 'Maruti Suzuki', model: 'Fronx', year: 2026,
      price: 930000, km: 0, fuel: 'Petrol', transmission: 'Manual',
      badge: '', badgeType: 'fair', image: 'assets/cars/placeholder.svg',
      rating: 0, reviews: 0, verified: true,
      ...over,
    } as any;
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('.price') as HTMLElement;
  }

  afterEach(() => fixture?.destroy());

  it('shows the trim band when the model has priced trims', () => {
    const el = render({ variantPriceMin: 684000, variantPriceMax: 1198000 });
    expect(el.textContent!.replace(/\s+/g, ' ').trim()).toBe('₹6.8L – ₹12.0L');
    // The stale catalogue figure must not appear at all.
    expect(el.textContent).not.toContain('9.3');
  });

  it('falls back to the asking price for a used car, which has no trims', () => {
    const el = render({ km: 42000, price: 550000 });
    expect(el.textContent!.trim()).toBe('₹5.5L');
  });

  it('shows one figure, not a range, when every trim costs the same', () => {
    const el = render({ variantPriceMin: 684000, variantPriceMax: 684000 });
    expect(el.textContent!.trim()).toBe('₹6.8L');
  });
});
