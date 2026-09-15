/**
 * A model priced through its trims reaches the buyer.
 *
 * REPORTED, with a screenshot of the New Cars page: "Explore New Cars — 1
 * models available", one card, above a catalogue of eight models. Nothing on
 * the page said a filter was in force, so the site looked empty rather than
 * filtered — the same shape of fault as the 2018 year default and the hidden
 * no-photograph cards, and the third time this session.
 *
 * THE RULE THAT HID THEM
 *
 * Two gates, saying the same outdated thing:
 *
 *   the API      priced_only -> cars.ex_showroom_price IS NOT NULL
 *   this service .filter(c => c.ex_showroom_price != null)
 *
 * That column stopped being where a model's price lives. The published trims
 * are: `variant_price_min`/`max` carry the band, and startingPrice, priceBand
 * and the whole New Cars grid read them in preference to the row, which
 * survives only as the fallback for a model whose trims are unpriced. So a
 * model with twelve published trims and a real band on its own detail page was
 * withheld from every buyer-facing grid because one legacy column was blank.
 *
 * WHAT DOES NOT CHANGE
 *
 * A model with no price anywhere — no row figure, no priced trim — is still
 * not shown. A grid that sorts and filters on price is not the place for it,
 * and that was the point of the flag. See the API's own tests in
 * test_car_prices.py, which pin both halves at the source.
 */
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

import { CarsDataService } from './cars-data.service';
import { environment } from '../../environments/environment';

function expectCall(http: HttpTestingController, url: string) {
  return http.expectOne(req => req.url.split('&_=')[0].split('?_=')[0] === url);
}

/** The fixture rows, told apart from the demo catalogue a dev build appends. */
const ID = '22222222-2222-2222-2222-222222222222';

const urls = {
  new: `${environment.apiUrl}/listings?listing_type=new&page=1&page_size=100`,
  used: `${environment.apiUrl}/listings?listing_type=used&page=1&page_size=100`,
  catalogue: `${environment.apiUrl}/cars?bucket=new&priced_only=true&page=1&page_size=100`,
};

/** A catalogue row as /cars returns one. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    make: 'Maruti Suzuki',
    model: 'Swift',
    variant: null,
    year: new Date().getFullYear(),
    fuel_type: 'petrol',
    transmission: 'manual',
    body_type: 'hatchback',
    ex_showroom_price: null,
    image_urls: ['https://cdn.gaadiiq.test/swift.webp'],
    ...over,
  };
}

/** Both listings sources empty; the catalogue answers with these rows. */
function answerRound(http: HttpTestingController, items: unknown[]): void {
  const empty = { items: [], total: 0, page: 1, page_size: 100 };
  expectCall(http, urls.new).flush(empty);
  expectCall(http, urls.used).flush(empty);
  expectCall(http, urls.catalogue).flush({
    items, total: items.length, page: 1, page_size: 100,
  });
}

/**
 * The service loads in its constructor, so injecting it starts a round that
 * has to be answered; reload returns the promise that one does not expose,
 * which is what makes the result awaitable.
 */
async function loadWith(http: HttpTestingController, svc: CarsDataService, items: unknown[]) {
  answerRound(http, items);
  const reloaded = svc.reload();
  answerRound(http, items);
  await reloaded;
}

describe('CarsDataService — a model priced by its trims', () => {
  let http: HttpTestingController;
  let svc: CarsDataService;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    http = TestBed.inject(HttpTestingController);
    svc = TestBed.inject(CarsDataService);
  });

  afterEach(() => http.verify());

  it('keeps a row whose own price column is blank but whose trims are priced', async () => {
    await loadWith(http, svc, [
      row({ variant_count: 12, variant_price_min: '580000', variant_price_max: '890000' }),
    ]);

    expect(svc.cars().filter(c => c.id === ID).map(c => c.model)).toEqual(['Swift']);
  });

  it('prices that card from the cheapest trim rather than at nothing', async () => {
    // Number(null) is 0, so the row used to arrive costing nothing — harmless
    // only while such rows were being discarded upstream, and a "₹0" card the
    // moment they stopped being. It also sank a fully-priced model to the
    // bottom of "price: low to high".
    await loadWith(http, svc, [
      row({ variant_count: 12, variant_price_min: '580000', variant_price_max: '890000' }),
    ]);

    const swift = svc.cars().find(c => c.id === ID)!;
    expect(swift.price).toBe(580000);
    expect(swift.variantPriceMin).toBe(580000);
    expect(swift.variantPriceMax).toBe(890000);
  });

  it('still drops a row with no price anywhere', async () => {
    // The half that must not change.
    await loadWith(http, svc, [row({ variant_count: 3 })]);

    expect(svc.cars().filter(c => c.id === ID)).toEqual([]);
  });

  it('keeps a row priced the old way, with no trims at all', async () => {
    await loadWith(http, svc, [row({ ex_showroom_price: 649000 })]);

    expect(svc.cars().filter(c => c.id === ID).map(c => c.price)).toEqual([649000]);
  });
});
