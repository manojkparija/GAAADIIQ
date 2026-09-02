/**
 * The AI Advisor recommends on the price the car actually starts at.
 *
 * Reported from a recommendation card: "Maruti Suzuki Fronx · ₹9.3L", with
 * "₹9.3L — fits your budget exactly" underneath, for a car whose cheapest trim
 * is ₹6.84L. ₹9.3L is the catalogue row's own figure and no trim is sold at it.
 *
 * This is the fourth screen to quote that number, but the first where it is
 * not only displayed: the monthly EMI, the insurance, the resale estimate and
 * the five-year total were all worked out from it, and the budget score was
 * decided on it. A wrong price on a card is a wrong label; a wrong price in a
 * recommendation is advice.
 *
 * `startPrice` is the figure the recommendation was made on, and every derived
 * cost follows it — so the headline, the comparison row and the EMI beside
 * them cannot drift apart again.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { signal } from '@angular/core';

import { AiAdvisorComponent } from './ai-advisor.component';
import { CarsDataService } from '../../services/cars-data.service';

const PHOTO = 'https://cdn.gaadiiq.test/fronx/front.webp';

/** The Fronx as the catalogue holds it: row ₹9.3L, trims ₹6.84L–₹11.98L. */
function fronx(over: Partial<any> = {}): any {
  return {
    id: 'fronx', make: 'Maruti Suzuki', model: 'Fronx', year: 2026,
    price: 930000, variantPriceMin: 684000, variantPriceMax: 1198000,
    km: 0, fuel: 'Petrol', transmission: 'Manual',
    image: PHOTO, images: [PHOTO], rating: 0, reviews: 0, verified: true,
    bodyType: 'SUV', fromCatalogue: true, variantCount: 14,
    specs: [{ label: 'Mileage (ARAI)', value: '21.79' }], features: [],
    ...over,
  };
}

function build(cars: any[], profile: Record<string, string | string[]> = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AiAdvisorComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: CarsDataService,
        useValue: {
          cars: signal(cars), loading: signal(false), failedSources: signal([]),
          // What computeResults actually reads.
          getAll: () => cars,
        },
      },
    ],
  });
  const c = TestBed.createComponent(AiAdvisorComponent).componentInstance as any;
  c.profile.set({ budget: ['₹5L – ₹10L'], ...profile });
  // computeResults is private; the scoring is the subject, so reach it directly
  // rather than driving four seconds of animated "analysing" timeouts.
  c.computeResults();
  return c;
}

describe('AI Advisor — the price a recommendation is made on', () => {
  it('quotes the cheapest trim, not the catalogue row', () => {
    const [top] = build([fronx()]).results();

    expect(top.startPrice).toBe(684000);
  });

  it('does not quote ₹9.3L anywhere on the card', () => {
    // The reported figure. It is a real number on the row and it is not a
    // price this car can be bought at.
    const [top] = build([fronx()]).results();

    expect(top.startPrice).not.toBe(930000);
  });

  it('says "fits your budget" about the price it is showing', () => {
    // The card contradicted itself in two lines: a headline from one number
    // and a pro quoting the same wrong one.
    const c = build([fronx()]);
    const [top] = c.results();
    const budgetPro = top.pros.find((p: string) => p.includes('budget'));

    expect(budgetPro).toBeDefined();
    expect(budgetPro).toContain(c.fmtP(top.startPrice));
  });

  it('works the EMI out from the same price', () => {
    // 80% financed over 60 months at 8.5%. On ₹9.3L that is about ₹15.3k and
    // the card said ₹15K; on the real entry price it is near ₹11.2k. A buyer
    // budgeting on the wrong one is out by roughly ₹4,000 a month.
    const [top] = build([fronx()]).results();
    const onRowPrice = Math.round(build([fronx()]).calcEmi(930000 * 0.8, 8.5, 60));

    expect(top.monthlyEmi).toBeLessThan(onRowPrice);
    expect(top.monthlyEmi).toBe(Math.round(build([fronx()]).calcEmi(684000 * 0.8, 8.5, 60)));
  });

  it('works the five-year cost out from the same price', () => {
    const [top] = build([fronx()]).results();

    // The whole of TCO leans on the purchase price, directly and through the
    // insurance and resale terms, so an error there is multiplied rather than
    // carried.
    expect(top.fiveYearTco).toBeLessThan(930000);
  });

  it('falls back to the row figure for a model with no priced trims', () => {
    // A car whose trims are not entered yet still has to be recommendable, and
    // the row's figure is the only price it has.
    const [top] = build([
      fronx({ id: 'x', model: 'Ignis', variantPriceMin: undefined, variantPriceMax: undefined }),
    ]).results();

    expect(top.startPrice).toBe(930000);
  });
});
