/**
 * The green pills on the New Cars cards are legible.
 *
 * Reported from the live site as "this colour letter is not visible at all",
 * and it measured 1.44:1 — the brand mint #38ef7d as *text* on a 10% tint of
 * itself, at 11px, against a 4.5:1 AA floor. The mint is a fill colour; the
 * --*-ink tokens are its text-only counterparts (see CLAUDE.md).
 *
 * WHY e2e/contrast.spec.ts DID NOT CATCH IT, THOUGH IT WALKS /new-cars
 *
 * Both pills need data. The feature chips render only inside the variants
 * drill-down, behind a click, and the cards themselves need the catalogue —
 * and CI starts no API, so that page renders empty and the sweep passes over
 * nothing. A route being "covered" is not the same as the element being
 * reached, and this is what the difference looks like.
 *
 * So this measures the same property where the data can be stubbed: the real
 * cascade in a real browser, on elements actually rendered.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { ListingsComponent } from './listings.component';
import { CarsDataService, Car } from '../../services/cars-data.service';

const AA_NORMAL = 4.5;

function srgb(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance([r, g, b]: number[]): number {
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function contrast(fg: number[], bg: number[]): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}
/** "rgb(r, g, b)" / "rgba(r, g, b, a)" → [r, g, b, a]. */
function parseColor(css: string): number[] {
  const n = css.match(/[\d.]+/g)!.map(Number);
  return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
}
/**
 * The colour actually behind an element, walking up until something opaque is
 * found and compositing the translucent layers back down over it.
 *
 * The whole bug lives in this detail: the chip's own background is only 10%
 * opaque, so reading `background-color` alone and comparing against it would
 * compare the text with a colour nothing on screen ever shows.
 */
function effectiveBackground(el: HTMLElement): number[] {
  const layers: number[][] = [];
  let node: HTMLElement | null = el;
  while (node) {
    const c = parseColor(getComputedStyle(node).backgroundColor);
    if (c[3] > 0) layers.push(c);
    if (c[3] === 1) break;
    node = node.parentElement;
  }
  // Nothing opaque found (a transparent chain up to the root): the page is
  // white underneath.
  let base = [255, 255, 255];
  for (const layer of layers.reverse()) {
    base = [0, 1, 2].map(i => layer[3] * layer[i] + (1 - layer[3]) * base[i]);
  }
  return base;
}

function car(over: Partial<Car>): Car {
  return {
    id: 'c1', make: 'Maruti Suzuki', model: 'Fronx', year: 2026,
    price: 930000, km: 0, fuel: 'Petrol', transmission: 'Manual',
    image: 'assets/cars/placeholder.svg', images: [],
    rating: 4, reviews: 10, verified: true, bodyType: 'SUV',
    variantCount: 12, variantPriceMin: 684000, variantPriceMax: 1198000,
    features: ['Head-Up Display', '360-Degree Camera', '9-inch SmartPlay Pro+'],
    ...over,
  } as Car;
}

describe('listings — green pill legibility', () => {
  let fixture: ComponentFixture<ListingsComponent>;
  let comp: ListingsComponent;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ListingsComponent],
      providers: [
        provideRouter([]),
        {
          provide: CarsDataService,
          useValue: { cars: signal([car({})]), loading: signal(false) },
        },
      ],
    });
    fixture = TestBed.createComponent(ListingsComponent);
    comp = fixture.componentInstance;
    comp.carType.set('New');
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  function assertLegible(selector: string) {
    const els: HTMLElement[] =
      Array.from(fixture.nativeElement.querySelectorAll(selector));
    expect(els.length).withContext(`nothing matched ${selector}`).toBeGreaterThan(0);

    for (const el of els) {
      const fg = parseColor(getComputedStyle(el).color);
      const bg = effectiveBackground(el);
      const ratio = contrast(fg, bg);
      expect(ratio).withContext(
        `"${el.textContent?.trim()}" — ${getComputedStyle(el).color} on ` +
        `rgb(${bg.map(Math.round).join(', ')}) = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  }

  it('the variant-count pill meets AA', () => {
    assertLegible('.nc-variant-count');
  });

  it('the feature chips in the variants drill-down meet AA', () => {
    // The state a click reaches, and the one e2e never enters.
    comp.selectedModel.set('Maruti Suzuki||Fronx');
    fixture.detectChanges();

    expect(comp.newModelVariants().length)
      .withContext('drill-down rendered no variants; the chips would not exist')
      .toBeGreaterThan(0);

    assertLegible('.nc-feature-chip');
  });
});
