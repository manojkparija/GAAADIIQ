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
// ListingsComponent injects HttpClient for the admin remove control. Without a
// provider every test here dies in the injector before reaching its subject —
// which is what happened, unnoticed, because CI runs Playwright but never
// `ng test`.
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
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
    // A real photograph: the model grid hides a model without one, and this
    // spec needs the card rendered in order to measure its contrast.
    image: 'https://cdn.gaadiiq.test/fronx/front.webp',
    images: ['https://cdn.gaadiiq.test/fronx/front.webp'],
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
        provideHttpClient(),
        provideHttpClientTesting(),
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

/**
 * The New / Used tabs are legible and blue-teal in both states.
 *
 * They sat in --muted with a grey border, which read as disabled beside the
 * one filled tab — and when selected, New Cars turned green and Used Cars
 * orange, so the same control changed hue depending on which tab you were on.
 *
 * The contrast assertion is the point: --primary clears AA on this background
 * (measured 5.57:1) but the brand mint would not, and the difference is not
 * visible in the source. The active tab is white on a gradient, which
 * getComputedStyle reports as a transparent background-color, so it is checked
 * for the gradient instead of a ratio.
 */
describe('listings — New / Used tabs', () => {
  let fixture: ComponentFixture<ListingsComponent>;
  let comp: ListingsComponent;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ListingsComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: CarsDataService, useValue: { cars: signal([car({})]), loading: signal(false) } },
      ],
    });
    fixture = TestBed.createComponent(ListingsComponent);
    comp = fixture.componentInstance;
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  function tabs(): HTMLElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.type-btn'));
  }

  it('renders all three tabs', () => {
    expect(tabs().length).toBe(3);
  });

  it('uses the same fill as the chips beside it', () => {
    // The complaint was that the tabs did not match the body-type chips, and
    // they did not: the chips, the buttons and the tabs each spelled out a
    // near-identical gradient by hand. Comparing the two computed values is
    // the only assertion that would have caught it — both "look blue-teal" in
    // the source.
    const chip = fixture.nativeElement.querySelector('.chip.active') as HTMLElement;
    expect(chip).withContext('no active chip to compare against').toBeTruthy();

    expect(getComputedStyle(tabs()[0]).backgroundImage)
      .toBe(getComputedStyle(chip).backgroundImage);
  });

  it('is legible now — the debt this used to pin has been paid', () => {
    // This case used to assert the worst stop was 2.43:1 and said, in its own
    // failure message, "if this improved, raise the expectation". It improved.
    //
    // --gradient-cta was linear-gradient(#2563EB, #06B6D4 55%, #14B8A6). White
    // measured 5.17 / 2.43 / 2.49:1 across those stops, so most of the width of
    // every primary button and selected chip in the app sat under the 4.5:1
    // floor and the label faded as it crossed its own background. The token is
    // now solid --primary (#295EE0), which measures 5.57:1.
    //
    // Still measured from the browser rather than from reading the stops: that
    // is what caught the cyan midpoint being worse than the teal end, which
    // reading the source would not have.
    const cs = getComputedStyle(tabs()[0]);
    const fill = cs.backgroundImage === 'none' ? cs.backgroundColor : cs.backgroundImage;
    const stops = fill.match(/rgba?\([^)]+\)/g) ?? [];

    expect(stops.length).withContext('no fill to measure').toBeGreaterThan(0);

    const worst = Math.min(...stops.map(st => contrast([255, 255, 255], parseColor(st))));
    expect(worst).withContext(
      `worst stop is ${worst.toFixed(2)}:1 — white on the selected tab must clear AA`,
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('gives the selected tab the house fill, whichever tab it is', () => {
    // Was "the brand gradient" and asserted the computed value contained
    // 'gradient'. The fill is solid now, so the property worth holding is the
    // one the original complaint was about: every tab shares ONE fill, and it
    // is not the old per-tab hues.
    for (const type of ['All', 'New', 'Used'] as const) {
      comp.setCarType(type);
      fixture.detectChanges();

      const active = tabs().find(t => t.classList.contains('active'))!;
      const cs = getComputedStyle(active);
      const bg = cs.backgroundImage === 'none' ? cs.backgroundColor : cs.backgroundImage;

      expect(bg).withContext(`${type} tab has no fill`).toBeTruthy();
      expect(bg).withContext(`${type} tab is transparent`).not.toBe('rgba(0, 0, 0, 0)');
      // The old per-tab hues: green for New, orange/yellow for Used.
      expect(bg).withContext(`${type} tab is still green`).not.toContain('56, 239, 125');
      expect(bg).withContext(`${type} tab is still orange`).not.toContain('255, 210, 0');
    }
  });
});
