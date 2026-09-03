import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';

import { AdvisorBriefComponent } from './advisor-brief.component';
import { AdvisorBrief, AdvisorPick, AdvisorVariant } from '../../services/api.service';

/**
 * The behaviours worth pinning are the ones that were wrong on the rendered
 * page but invisible to a passing build.
 */

function brief(over: Partial<AdvisorBrief> = {}): AdvisorBrief {
  return {
    request_id: 'r1',
    understood: [],
    missing: [],
    items: [],
    total_considered: 0,
    assumptions: {},
    message: null,
    ...over,
  };
}

function pick(over: Partial<AdvisorPick> = {}): AdvisorPick {
  return {
    car_id: 'c1', make: 'Tata', model: 'Nexon', year: 2026, body_type: 'suv',
    match_score: 90, reasons: [], concerns: [], variant: null,
    monthly_emi: { label: 'Monthly EMI', amount: 15000, basis: 'calculated', note: '' },
    five_year: [], five_year_total: 500000, five_year_excludes: [],
    cost_per_km: null, resale_five_year: null, resale_source: 'heuristic',
    ...over,
  };
}

describe('AdvisorBriefComponent', () => {
  let component: AdvisorBriefComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdvisorBriefComponent, HttpClientTestingModule],
    });
    component = TestBed.createComponent(AdvisorBriefComponent).componentInstance;
  });

  it('creates', () => {
    expect(component).toBeTruthy();
  });

  describe('missingPrompts', () => {
    it('returns the same array instance until the result changes', () => {
      // The bug this guards: as a method it allocated a fresh array of fresh
      // objects on every change-detection pass, so the *ngFor over it tore
      // down and rebuilt its views every cycle and scheduled another one. The
      // page rendered forever — a browser screenshot of it timed out. Stable
      // identity between reads is exactly the property that was missing.
      component.result.set(brief({ missing: ['km_per_month'], items: [pick()] }));

      const first = component.missingPrompts();
      const second = component.missingPrompts();

      expect(second).toBe(first);
    });

    it('produces a new array once the result actually changes', () => {
      component.result.set(brief({ missing: ['km_per_month'] }));
      const before = component.missingPrompts();

      component.result.set(brief({ missing: ['seats'] }));

      expect(component.missingPrompts()).not.toBe(before);
      expect(component.missingPrompts()[0].key).toBe('seats');
    });

    it('only offers the fields that can be answered with a number', () => {
      component.result.set(brief({ missing: ['budget', 'usage', 'seats', 'km_per_month'] }));

      expect(component.missingPrompts().map(p => p.key)).toEqual(['seats', 'km_per_month']);
    });

    it('captions the fields without title-casing them into nonsense', () => {
      // `| titlecase` rendered the ordinary question as "How Far You Drive
      // Each Month".
      component.result.set(brief({ missing: ['km_per_month'] }));

      expect(component.missingPrompts()[0].caption).toBe('Km per month');
    });
  });

  describe('missingNarrative', () => {
    it('mentions only the fields that cannot be asked inline', () => {
      component.result.set(brief({ missing: ['budget', 'km_per_month'] }));

      const text = component.missingNarrative();
      expect(text).toContain('your budget');
      expect(text).not.toContain('how far');
    });

    it('is empty when nothing is left to ask', () => {
      component.result.set(brief({ missing: [] }));
      expect(component.missingNarrative()).toBe('');
    });
  });

  describe('money', () => {
    it('shows an unknown figure as a dash, never as zero', () => {
      // A "₹0" here reads as free. The whole point of a null amount is that
      // the number is not known, and the two must not look the same.
      expect(component.money(null)).toBe('—');
      expect(component.money(undefined)).toBe('—');
      expect(component.money(0)).toBe('₹0');
    });

    it('uses the units Indian buyers read', () => {
      expect(component.money(899000)).toBe('₹8.99 L');
      expect(component.money(12000000)).toBe('₹1.20 Cr');
      expect(component.money(15000)).toBe('₹15,000');
    });
  });

  describe('isPartial', () => {
    it('is true when the total omits a component it could not compute', () => {
      expect(component.isPartial(pick({ five_year_excludes: ['Fuel'] }))).toBe(true);
      expect(component.isPartial(pick({ five_year_excludes: [] }))).toBe(false);
    });
  });

  describe('canSubmit', () => {
    it('tracks the plain ngModel field rather than going stale', () => {
      // Deliberately a method, not a computed(): computed() tracks signal
      // reads only, and over a plain field it evaluates once and then reports
      // a stale answer forever. This asserts it keeps up.
      expect(component.canSubmit()).toBe(false);
      component.query = 'I have 12 lakh';
      expect(component.canSubmit()).toBe(true);
    });

    it('refuses while a request is already running', () => {
      component.query = 'I have 12 lakh';
      component.busy.set(true);
      expect(component.canSubmit()).toBe(false);
    });
  });

  describe('the side-by-side table', () => {
    /**
     * Reported as "the fuel/km calculation looks wrong": a CNG S-Presso at
     * ₹2.69/km beside a petrol Fronx at ₹5.30/km.
     *
     * The arithmetic was right — ownership_cost.py holds CNG at ₹88/kg and
     * petrol at ₹106/L, so 88/32.7 and 106/20.0 are exactly those figures. The
     * fault was that the table gave the reader no way to see it. Fuel type
     * appeared only as grey text in the variant subtitle of the header cell,
     * and the row that makes the ~2x gap obvious did not exist. A correct
     * number that reads as a bug is still a defect on the page.
     */
    function variant(over: Partial<AdvisorVariant> = {}): AdvisorVariant {
      return {
        id: 'v1', name: 'VXi Plus', ex_showroom_price: 640000,
        fuel_type: 'CNG', transmission: 'Manual', seating_capacity: 5,
        mileage: '32.73 km/kg', reason: '', priced_out: [],
        ...over,
      };
    }

    function render(items: AdvisorPick[]): HTMLElement {
      const fixture = TestBed.createComponent(AdvisorBriefComponent);
      fixture.componentInstance.result.set(brief({ items }));
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    function rowValues(el: HTMLElement, heading: string): string[] {
      const row = Array.from(el.querySelectorAll('.compare-table tbody tr')).find(
        tr => tr.querySelector('th')?.textContent?.trim() === heading,
      );
      if (!row) return [];
      return Array.from(row.querySelectorAll('td')).map(td => td.textContent!.trim());
    }

    const twoCars = () => [
      pick({
        car_id: 'a', make: 'Maruti Suzuki', model: 'S-Presso',
        cost_per_km: 2.69,
        variant: variant({ fuel_type: 'CNG' }),
      }),
      pick({
        car_id: 'b', make: 'Maruti Suzuki', model: 'Fronx',
        cost_per_km: 5.3,
        variant: variant({ name: 'Alpha AT', fuel_type: 'Petrol', mileage: '20.01 kmpl' }),
      }),
    ];

    it('names each car\'s fuel, so the running-cost gap is explained', () => {
      expect(rowValues(render(twoCars()), 'Fuel')).toEqual(['CNG', 'Petrol']);
    });

    it('puts Fuel directly above Fuel / km', () => {
      // Adjacency is the whole point — the row explains the one beneath it.
      // Two rows apart and the reader has stopped connecting them.
      const el = render(twoCars());
      const headings = Array.from(el.querySelectorAll('.compare-table tbody tr th'))
        .map(th => th.textContent!.trim());
      expect(headings.indexOf('Fuel / km') - headings.indexOf('Fuel')).toBe(1);
    });

    it('shows a dash rather than a blank when the fuel is not recorded', () => {
      const items = [
        pick({ car_id: 'a', variant: variant({ fuel_type: null }) }),
        pick({ car_id: 'b', variant: null }),
      ];
      expect(rowValues(render(items), 'Fuel')).toEqual(['—', '—']);
    });

    it('leaves the cost figures themselves untouched', () => {
      // The fix is presentational. If this ever starts failing, something has
      // changed the numbers rather than how they are explained.
      expect(rowValues(render(twoCars()), 'Fuel / km')).toEqual(['₹2.69', '₹5.3']);
    });
  });
});
