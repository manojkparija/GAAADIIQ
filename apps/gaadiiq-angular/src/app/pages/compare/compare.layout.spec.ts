/**
 * The comparison table lines up, and fits on a phone.
 *
 * Reported against the APK: the compare table was misaligned. Two causes, both
 * in `grid-template-columns: 180px repeat(3, 1fr)`.
 *
 * The `3` was fixed, but the table renders from two cars up. Comparing two laid
 * every row out in four columns and left an empty one on the right, so the
 * header, the spec rows and the feature rows each ended somewhere different
 * from the cars above them.
 *
 * The mobile half was worse. `.comparison-table` is `overflow: hidden`, so at
 * 360px the three car columns were squeezed to 80px each — narrower than the
 * "View Details" button inside them — and clipped rather than scrollable.
 *
 * The rules that would have prevented this had been written: a scroll
 * container, 130px column floors, a sticky label column, all tagged LAY-002 and
 * LAY-003. They were attached to `.sticky-header` and `.spec-row`, which the
 * template stopped using when it moved to `.comp-header`/`.comp-row`. Nothing
 * failed, because dead CSS does not fail.
 *
 * So these tests measure the rendered geometry rather than reading the
 * stylesheet: they compare where the columns actually land. A rule that stops
 * matching goes quiet, and a text search for it cannot tell the difference.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { CompareComponent } from './compare.component';
import { CarsDataService } from '../../services/cars-data.service';

const PHOTO = 'https://cdn.gaadiiq.test/fronx/front.webp';

function car(over: Partial<any> = {}): any {
  return {
    id: `id-${over['model'] ?? 'x'}`, make: 'Maruti Suzuki', model: 'Fronx',
    year: 2026, price: 1198000, km: 0, fuel: 'Petrol', transmission: 'Manual',
    badge: '', badgeType: '', image: PHOTO, images: [PHOTO],
    rating: 0, reviews: 0, verified: true, bodyType: 'SUV',
    isSellerListing: false, fromCatalogue: true, variantCount: 14,
    ...over,
  };
}

let host: HTMLElement | null = null;

/**
 * Render at a real width. Karma's page is desktop-wide, so a media query at
 * 768px never applies unless the host is actually narrowed — a test that skips
 * this passes at every viewport and therefore tests nothing about mobile.
 */
function mount(models: string[], width: number) {
  TestBed.resetTestingModule();
  const cars = models.map(m => car({ model: m }));
  TestBed.configureTestingModule({
    imports: [CompareComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { queryParams: of({}), snapshot: { queryParams: {} } } },
      { provide: CarsDataService, useValue: { cars: signal(cars), loading: signal(false), failedSources: signal([]) } },
    ],
  });
  const fixture = TestBed.createComponent(CompareComponent);
  const c = fixture.componentInstance as any;
  c.ngOnInit();
  cars.forEach((x, i) => c.selectCar(i, x));

  host = document.createElement('div');
  host.style.width = `${width}px`;
  document.body.appendChild(host);
  host.appendChild(fixture.nativeElement);
  fixture.detectChanges();

  const el = fixture.nativeElement as HTMLElement;
  return { c, el, table: el.querySelector('.comparison-table') as HTMLElement };
}

afterEach(() => {
  host?.remove();
  host = null;
});

/** Left edge of every cell in a row, relative to the row itself. */
function columnEdges(row: Element): number[] {
  const base = row.getBoundingClientRect().left;
  return Array.from(row.children).map(
    cell => Math.round(cell.getBoundingClientRect().left - base),
  );
}

describe('CompareComponent — the table lines up', () => {
  it('puts the spec rows on the same columns as the car headers', () => {
    const { el } = mount(['Fronx', 'Brezza', 'Baleno'], 1200);

    const header = columnEdges(el.querySelector('.comp-header')!);
    const specRow = columnEdges(el.querySelector('.comp-row')!);

    expect(specRow).toEqual(header);
  });

  it('lines the feature rows up with them too', () => {
    // .feat-row is a third selector sharing the same template; it drifted
    // independently of .comp-row when the column count was wrong.
    const { el } = mount(['Fronx', 'Brezza', 'Baleno'], 1200);

    expect(columnEdges(el.querySelector('.feat-row')!))
      .toEqual(columnEdges(el.querySelector('.comp-header')!));
  });

  it('lines up when only two cars are compared', () => {
    // The reported case. The table renders from two cars up, and the grid used
    // to declare three regardless.
    const { el } = mount(['Fronx', 'Brezza'], 1200);

    expect(columnEdges(el.querySelector('.comp-row')!))
      .toEqual(columnEdges(el.querySelector('.comp-header')!));
  });

  it('gives two cars the whole table, not two thirds of it', () => {
    // Alignment alone would still be satisfied by a fourth empty column, so
    // this pins the symptom the eye actually catches: the last car has to
    // reach the right-hand edge.
    const { el } = mount(['Fronx', 'Brezza'], 1200);

    const row = el.querySelector('.comp-row')!;
    const cells = Array.from(row.children);
    const last = cells[cells.length - 1].getBoundingClientRect();

    expect(cells.length).withContext('one label + two values').toBe(3);
    // Against the row's own box, not the table's: the glass card carries a 1px
    // border, so the table's border-box is a pixel wider than the grid inside
    // it and the comparison fails by one on a table that is laid out correctly.
    expect(Math.round(last.right)).toBe(Math.round(row.getBoundingClientRect().right));
  });
});

describe('CompareComponent — on a phone', () => {
  it('does not squeeze the car columns below a readable width', () => {
    // At 360px with three 1fr columns beside a 120px label, each car column was
    // 80px — narrower than the "View Details" button standing in it.
    const { el } = mount(['Fronx', 'Brezza', 'Baleno'], 360);

    const carCells = Array.from(el.querySelector('.comp-header')!.children).slice(1);
    const widths = carCells.map(c => c.getBoundingClientRect().width);

    widths.forEach(w => expect(w).toBeGreaterThanOrEqual(120));
  });

  it('lets the table scroll sideways instead of clipping it', () => {
    // overflow:hidden kept the card's rounded corners and cut the far column
    // off at the screen edge with no way to reach it.
    const { table } = mount(['Fronx', 'Brezza', 'Baleno'], 360);

    expect(getComputedStyle(table).overflowX).toBe('auto');
  });

  it('still lines the rows up once it overflows', () => {
    // The alignment has to survive the scroll container, which is where a
    // per-row width would show up as a stagger.
    const { el } = mount(['Fronx', 'Brezza', 'Baleno'], 360);

    expect(columnEdges(el.querySelector('.comp-row')!))
      .toEqual(columnEdges(el.querySelector('.comp-header')!));
  });
});
