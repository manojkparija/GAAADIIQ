/**
 * Every outage panel says why, not just that.
 *
 * WHAT THIS PREVENTS COMING BACK
 *
 * The catalogue failed intermittently on the live site for a day. Six changes
 * were made against the wrong layer — the service worker, edge cache TTLs, the
 * auth interceptor, cache-busting — because nobody had the actual error. The
 * moment /new-cars was made to print the reason it read:
 *
 *     /cars?bucket=new&priced_only=true&page=1&page_size=100
 *       — HTTP 504 Gateway Timeout
 *
 * which named the layer in one line.
 *
 * /used-cars and /car/:id failed on the same morning and carried no reason, so
 * what THOSE two hit is still unknown — the screenshots that came back said
 * only "we couldn't load". That gap is what these tests close. The fault is
 * intermittent, so the panel already on the reporter's screen is the only
 * realistic place the error can be captured; a panel that omits it costs
 * another day.
 *
 * These assert the wiring, not the wording: the reason reaches the DOM when
 * there is one, and no empty line is rendered when there is not.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { CarsDataService } from '../services/cars-data.service';
import { UsedCarsComponent } from './used-cars/used-cars.component';
import { CarDetailComponent } from './car-detail/car-detail.component';

const REASON = '/cars?bucket=new&page=1 — HTTP 504 Gateway Timeout';

function setup() {
  TestBed.configureTestingModule({
    imports: [UsedCarsComponent, CarDetailComponent, RouterTestingModule],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  // The service loads the catalogue from its own constructor; the testing
  // backend leaves those requests pending, which is the state we want anyway.
  return TestBed.inject(CarsDataService);
}

describe('the used cars outage panel', () => {
  let carsData: CarsDataService;

  beforeEach(() => {
    carsData = setup();
    carsData.loading.set(false);
    carsData.failedSources.set(['used']);
  });

  it('prints the reason the listings request failed', () => {
    carsData.lastFailure.set(REASON);

    const fixture = TestBed.createComponent(UsedCarsComponent);
    fixture.detectChanges();

    const line = fixture.nativeElement.querySelector('.uc-failure-detail');
    expect(line)
      .withContext('the panel is up but carries no reason — the day this cost is in the file header')
      .toBeTruthy();
    expect(line.textContent.trim()).toBe(REASON);
  });

  it('renders nothing when there is no reason to give', () => {
    // An empty <p> under the button is a stray gap on a page that is already
    // telling somebody bad news.
    carsData.lastFailure.set('');

    const fixture = TestBed.createComponent(UsedCarsComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.uc-failure-detail')).toBeNull();
  });
});

describe('the car detail outage panel', () => {
  let carsData: CarsDataService;

  beforeEach(() => {
    carsData = setup();
    carsData.loading.set(false);
  });

  it('prints the reason the car could not be loaded', () => {
    carsData.lastFailure.set(REASON);

    const fixture = TestBed.createComponent(CarDetailComponent);
    // loadFailed is set by resolveCar(), which needs a route and a catalogue.
    // The panel's own condition is what this test is about, so drive it
    // directly rather than staging a failure the router would have to produce.
    fixture.componentInstance.loadFailed.set(true);
    fixture.detectChanges();

    const line = fixture.nativeElement.querySelector('.cd-failure-detail');
    expect(line)
      .withContext('"the catalogue is unreachable" with no clue which part was unreachable')
      .toBeTruthy();
    expect(line.textContent.trim()).toBe(REASON);
  });

  it('renders nothing when there is no reason to give', () => {
    carsData.lastFailure.set('');

    const fixture = TestBed.createComponent(CarDetailComponent);
    fixture.componentInstance.loadFailed.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.cd-failure-detail')).toBeNull();
  });
});
