import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { CarsDataService } from './cars-data.service';
import { environment } from '../../environments/environment';

/**
 * The catalogue is assembled from three independent sources: new listings,
 * used listings, and the manufacturer catalogue that admin-uploaded
 * photography lands in.
 *
 * They were fetched with Promise.all, which rejects as soon as any one of them
 * does. When /listings started failing — its table in the deployed database
 * was missing the price column — the catalogue call succeeded and its result
 * was thrown away with the rest, so the New Cars pages showed "0 models
 * available" for cars that were priced, photographed and ready to sell.
 *
 * A source that fails should cost only its own rows.
 */
const CATALOGUE_CAR = {
  id: '11111111-1111-1111-1111-111111111111',
  make: 'Maruti Suzuki',
  model: 'Dzire',
  variant: 'ZXi',
  year: new Date().getFullYear(),
  fuel_type: 'petrol',
  transmission: 'manual',
  body_type: 'sedan',
  ex_showroom_price: 899000,
  image_urls: ['https://example.test/dzire.webp'],
};

describe('CarsDataService — one failing source', () => {
  let http: HttpTestingController;

  const urls = {
    // page=1 is explicit now: the catalogue is fetched page by page, because
    // the API caps a page at 100 and a longer catalogue was silently truncated.
    new: `${environment.apiUrl}/listings?listing_type=new&page=1&page_size=100`,
    used: `${environment.apiUrl}/listings?listing_type=used&page=1&page_size=100`,
    catalogue: `${environment.apiUrl}/cars?bucket=new&priced_only=true&page=1&page_size=100`,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HttpClientTestingModule] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Answer one round of fetches: both listings calls fail, the catalogue answers. */
  function answerRound(): void {
    const failed = { status: 500, statusText: 'Internal Server Error' };
    const error = { detail: 'column listings.price does not exist' };

    http.expectOne(urls.new).flush(error, failed);
    http.expectOne(urls.used).flush(error, failed);
    http.expectOne(urls.catalogue).flush({
      items: [CATALOGUE_CAR],
      total: 1,
      page: 1,
      page_size: 100,
    });
  }

  it('keeps catalogue cars when /listings fails', async () => {
    // The service loads in its constructor, so injecting it starts a round.
    const svc = TestBed.inject(CarsDataService);
    answerRound();

    // reload returns the promise the constructor's load does not expose, which
    // is what makes the result awaitable.
    const reloaded = svc.reload();
    answerRound();
    await reloaded;

    expect(svc.getAll().find(c => c.model === 'Dzire'))
      .withContext('a priced catalogue model must survive a listings outage')
      .toBeTruthy();
  });
});
