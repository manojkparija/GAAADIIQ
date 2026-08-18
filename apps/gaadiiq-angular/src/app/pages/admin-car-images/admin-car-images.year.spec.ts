/**
 * The two year pickers.
 *
 * These were the last native <select> elements in the app. They were left
 * native on purpose while every other dropdown was replaced, because they
 * bound [ngValue] with numbers and null while the replacement stores text —
 * so converting them risked turning a year into the string "2022", or the
 * empty choice into the year 0, on a screen behind adminGuard that nobody
 * would notice was broken.
 *
 * They are converted now, and these pin the coercion in both directions. The
 * failure this guards against is silent: an upload tagged with year 0, or a
 * query that filters on text where the API expects a number, looks exactly
 * like a working screen until someone reads the database.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AdminCarImagesComponent } from './admin-car-images.component';

describe('AdminCarImagesComponent — year pickers', () => {
  let c: AdminCarImagesComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminCarImagesComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    c = TestBed.createComponent(AdminCarImagesComponent).componentInstance;
  });

  it('stores a picked year as a number, not the text of one', () => {
    c.onIdentityPick('year', '2022');
    expect(c.modelYear()).toBe(2022);
    expect(typeof c.modelYear()).toBe('number');
  });

  it('turns the empty choice into null rather than the year 0', () => {
    // Number('') is 0. An upload tagged with model_year 0 is accepted by the
    // API and is wrong everywhere afterwards.
    c.onIdentityPick('year', '2022');
    c.onIdentityPick('year', '');
    expect(c.modelYear()).toBeNull();
  });

  it('still recognises the add-new sentinel', () => {
    c.onIdentityPick('year', c.ADD_NEW);
    expect(c.customYear()).toBeTrue();
    expect(c.modelYear()).toBeNull();
  });

  it('stores the filter year as a number and "All years" as null', () => {
    c.onManageYear('2021');
    expect(c.manageYear()).toBe(2021);

    c.onManageYear('');
    expect(c.manageYear()).toBeNull();
  });

  it('renders the signal back as the text the dropdown holds', () => {
    // The round trip: null must not come back as "null", which would show a
    // selected row reading "null" instead of the placeholder.
    expect(c.yearAsText(null)).toBe('');
    expect(c.yearAsText(2024)).toBe('2024');
  });

  it('offers an empty choice at the top of both lists', () => {
    expect(c.manageYearSelectOptions()[0]).toEqual({ value: '', label: 'All years' });
    expect(c.modelYearSelectOptions()[0]).toEqual({ value: '', label: 'Select year…' });
  });

  it('keeps add-new last in the identity list', () => {
    const opts = c.modelYearSelectOptions();
    expect(opts[opts.length - 1].value).toBe(c.ADD_NEW);
  });
});
