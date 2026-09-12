/**
 * A priced model that no buyer can see is named, not left to be noticed.
 *
 * WHAT THIS COMES FROM
 *
 * Reported as "I uploaded Baleno images and they are not visible in the new
 * car section". Everything about the car was right: the catalogue row existed
 * at 2026, priced at ₹6.10L, with ten variants from ₹6.10L to ₹10.09L. But
 * /listings?carType=New&make=Maruti%20Suzuki said "2 models available" while
 * the catalogue holds five Maruti models, and Baleno was not among them.
 *
 * The rule doing it is isShowable() in cars-data.service:
 *
 *     car.fromCatalogue === false || hasPhotograph(car)
 *
 * A catalogue row with no photograph is hidden from every buyer-facing list.
 * Keep that: an advert is a real car someone is selling and must never be
 * hidden for want of a picture, while a catalogue row without one is only
 * missing data. What was absent is any way to SEE it — the model simply was
 * not on the page, and the only way to notice was to count cards against a
 * dropdown.
 *
 * (The photographs that had been approved were in `car_images`, the dealer
 * listing store, which urls_for_cars never reads. So approving them could not
 * have populated image_urls no matter how many times it was done.)
 *
 * WHY THIS ASKS THE API THE WAY IT DOES
 *
 * The panel issues exactly the New Cars query — bucket=new, priced_only=true —
 * so what it reports cannot drift from the rule it reports on. A test below
 * pins that, because a panel that quietly checked a different question would
 * be worse than none: it would answer confidently and wrongly.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AdminCarImagesComponent } from './admin-car-images.component';

function car(over: Partial<any> = {}): any {
  return {
    id: 'c1', make: 'Maruti Suzuki', model: 'Baleno', year: 2026,
    ex_showroom_price: '610000.00', image_urls: [],
    ...over,
  };
}

/** Stand in for the API, and record what was asked. */
function stubFetch(pages: any[]): string[] {
  const urls: string[] = [];
  (globalThis as any).fetch = (url: string) => {
    urls.push(String(url));
    if (!String(url).includes('/cars?')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) });
    }
    const page = Number(new URL(String(url), 'https://x').searchParams.get('page') ?? 1);
    const body = pages[page - 1] ?? { items: [], total: 0 };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };
  return urls;
}

function mount(): AdminCarImagesComponent {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AdminCarImagesComponent, RouterTestingModule],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return TestBed.createComponent(AdminCarImagesComponent).componentInstance;
}

describe('AdminCarImagesComponent — priced models hidden for want of a photograph', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('names a priced model with no photographs', async () => {
    // The reported car, exactly as the API returned it.
    stubFetch([{ items: [car()], total: 1 }]);
    const c = mount();

    await (c as any).loadHiddenModels();

    expect(c.hiddenForNoPhoto()).toEqual([
      { make: 'Maruti Suzuki', model: 'Baleno', year: 2026 },
    ]);
  });

  it('leaves out a model that has photographs', async () => {
    // Fronx and S-Presso were the two that DID appear; they must not be
    // reported as a problem.
    stubFetch([{
      items: [
        car({ id: 'a', model: 'Fronx', image_urls: ['https://cdn.test/fronx.webp'] }),
        car({ id: 'b', model: 'Baleno' }),
      ],
      total: 2,
    }]);
    const c = mount();

    await (c as any).loadHiddenModels();

    expect(c.hiddenForNoPhoto().map(m => m.model)).toEqual(['Baleno']);
  });

  it('asks the API the same question New Cars asks', async () => {
    // The panel's whole value is that it reports on the live rule. If this
    // query drifts from /cars?bucket=new&priced_only=true, the panel starts
    // answering a different question with the same confidence.
    const urls = stubFetch([{ items: [], total: 0 }]);
    const c = mount();

    await (c as any).loadHiddenModels();

    const carsCall = urls.find(u => u.includes('/cars?'));
    expect(carsCall).toBeTruthy();
    expect(carsCall!).toContain('bucket=new');
    expect(carsCall!).toContain('priced_only=true');
  });

  it('reads every page, not just the first', async () => {
    // The catalogue is past a hundred rows and page_size caps at 100, so a
    // single-page read would silently under-report — which is the same class
    // of fault as the one being fixed.
    stubFetch([
      { items: [car({ id: 'a', model: 'A' })], total: 2 },
      { items: [car({ id: 'b', model: 'B' })], total: 2 },
    ]);
    const c = mount();

    await (c as any).loadHiddenModels();

    expect(c.hiddenForNoPhoto().map(m => m.model)).toEqual(['A', 'B']);
  });

  it('counts one model held at two years as one model', async () => {
    // Asked directly: "already models are visible, then why is this
    // information there?" — the panel read "2 models" for a single Grand
    // Vitara sitting at 2025 and 2026, which looks like two cars needing
    // attention. It is one car needing attention in two places, and the count
    // is the first thing anyone reads.
    stubFetch([{
      items: [
        car({ id: 'a', model: 'Grand Vitara', year: 2025 }),
        car({ id: 'b', model: 'Grand Vitara', year: 2026 }),
      ],
      total: 2,
    }]);
    const c = mount();

    await (c as any).loadHiddenModels();

    expect(c.hiddenModelGroups().length).toBe(1);
    expect(c.hiddenModelGroups()[0].make).toBe('Maruti Suzuki');
    expect(c.hiddenModelGroups()[0].model).toBe('Grand Vitara');
  });

  it('keeps every year, in order, because each needs its own upload', async () => {
    // Photographs attach by make, model AND year, all three exact. Collapsing
    // to the model alone would turn an overstatement into an understatement:
    // an admin uploads once, the entry survives, and nothing says why.
    stubFetch([{
      items: [
        car({ id: 'a', model: 'Grand Vitara', year: 2026 }),
        car({ id: 'b', model: 'Grand Vitara', year: 2024 }),
        car({ id: 'c', model: 'Grand Vitara', year: 2025 }),
      ],
      total: 3,
    }]);
    const c = mount();

    await (c as any).loadHiddenModels();

    expect(c.hiddenModelGroups()[0].years).toEqual([2024, 2025, 2026]);
  });

  it('keeps genuinely different models apart', async () => {
    // The grouping key is make and model together, so two manufacturers'
    // identically-named models do not merge into one entry.
    stubFetch([{
      items: [
        car({ id: 'a', make: 'Maruti Suzuki', model: 'Baleno', year: 2026 }),
        car({ id: 'b', make: 'Toyota', model: 'Glanza', year: 2026 }),
      ],
      total: 2,
    }]);
    const c = mount();

    await (c as any).loadHiddenModels();

    expect(c.hiddenModelGroups().length).toBe(2);
  });

  it('says so when the check itself fails', async () => {
    // A silent absence is what caused the report in the first place; this
    // panel must never become one.
    (globalThis as any).fetch = () => Promise.reject(new Error('offline'));
    const c = mount();

    await (c as any).loadHiddenModels();

    expect(c.hiddenError()).toBeTruthy();
    expect(c.hiddenForNoPhoto()).toEqual([]);
  });
});
