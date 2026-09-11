/**
 * An admin can correct a catalogue model's fuel type.
 *
 * WHAT THIS COMES FROM
 *
 * The Grand Vitara detail page read "Fuel: Electric". The row genuinely says
 * `electric` — and nothing in the product could change it. PATCH /cars/{id}
 * has always accepted fuel_type; the only screen calling it sent the price and
 * nothing else.
 *
 * WHY IT IS NOT COSMETIC
 *
 * car-detail derives money from this column:
 *
 *   line  912  annual running cost as electricity at ₹1.5/km, not petrol
 *   line  911  mileage defaults to 0 for an EV
 *   line 1022  depreciation at 12% (the EV rate) instead of 15%
 *   html  370  the fuel-price control is hidden entirely
 *
 * So a buyer comparing running costs on a petrol SUV was shown EV economics.
 * The badge fix stopped the card claiming EV; only correcting the data fixes
 * the numbers.
 *
 * THE CARE THIS NEEDS
 *
 * PATCH applies the fields it is sent. Including fuel_type on every save would
 * restate the column whenever anyone edited a price — committing a value
 * nobody chose, in a screen people open to change money. The test below pins
 * that it rides along only when actually changed.
 */
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { RouterTestingModule } from '@angular/router/testing';
import { AdminPricingComponent } from './admin-pricing.component';

function mount(): { c: any; http: HttpTestingController } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AdminPricingComponent, RouterTestingModule],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const c: any = TestBed.createComponent(AdminPricingComponent).componentInstance;
  return { c, http: TestBed.inject(HttpTestingController) };
}

function row(over: Partial<any> = {}): any {
  return {
    id: 'gv-2026', make: 'Maruti Suzuki', model: 'Grand Vitara', variant: null,
    year: 2026, price: 1619000, imageCount: 10,
    fuel: 'electric', editFuel: 'electric',
    editPrice: 1619000, editing: true, saving: false, error: '',
    overrideWarning: true,   // skip the reference check; not what this tests
    ...over,
  };
}

describe('AdminPricingComponent — correcting a model fuel type', () => {
  it('sends the corrected fuel when it changed', async () => {
    // The reported row: electric on a petrol SUV.
    const { c, http } = mount();
    const r = row({ editFuel: 'petrol' });

    const saving = c.savePrice(r);
    const req = http.expectOne(rq => rq.url.includes('/cars/gv-2026'));

    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.fuel_type).toBe('petrol');
    req.flush({ id: 'gv-2026', fuel_type: 'petrol', ex_showroom_price: '1619000' });
    await saving;
  });

  it('leaves fuel out of a price-only save', async () => {
    // The one that protects every other row. PATCH applies what it is sent, so
    // an unconditional fuel_type would rewrite the column on every price edit.
    const { c, http } = mount();
    const r = row({ editPrice: 1700000 });

    const saving = c.savePrice(r);
    const req = http.expectOne(rq => rq.url.includes('/cars/gv-2026'));

    expect('fuel_type' in req.request.body).toBeFalse();
    expect(req.request.body.ex_showroom_price).toBe('1700000');
    req.flush({ id: 'gv-2026', fuel_type: 'electric', ex_showroom_price: '1700000' });
    await saving;
  });

  it('clears the column when the fuel is set back to unknown', async () => {
    // "Not set" is an honest state — better than leaving a guess in place —
    // and null is what the API takes for it.
    const { c, http } = mount();
    const r = row({ editFuel: '' });

    const saving = c.savePrice(r);
    const req = http.expectOne(rq => rq.url.includes('/cars/gv-2026'));

    expect(req.request.body.fuel_type).toBeNull();
    req.flush({ id: 'gv-2026', fuel_type: null, ex_showroom_price: '1619000' });
    await saving;
  });

  it('takes the saved fuel from the response, not from what was typed', async () => {
    // A row showing the typed value while the database holds another is the
    // disagreement this screen exists to end.
    const { c, http } = mount();
    const r = row({ editFuel: 'petrol' });

    const saving = c.savePrice(r);
    http.expectOne(rq => rq.url.includes('/cars/gv-2026'))
      .flush({ id: 'gv-2026', fuel_type: 'hybrid', ex_showroom_price: '1619000' });
    await saving;

    expect(r.fuel).toBe('hybrid');
    expect(r.editFuel).toBe('hybrid');
  });

  it('offers exactly the fuels the API accepts', async () => {
    // Anything outside models/car.py's FuelType is a 422 discovered after
    // pressing save — on a screen being used to correct a wrong fuel.
    const { c } = mount();

    expect(c.fuelOptions.map((o: any) => o.value))
      .toEqual(['', 'petrol', 'diesel', 'cng', 'hybrid', 'electric']);
  });

  it('restores the stored fuel when an edit is cancelled', async () => {
    const { c } = mount();
    const r = row({ editFuel: 'petrol' });

    c.cancelEdit(r);

    expect(r.editFuel).toBe('electric');
    expect(r.editing).toBeFalse();
  });
});

/**
 * The table's columns line up.
 *
 * WHY THIS EXISTS
 *
 * Adding the Fuel column shipped a broken table: the edit that inserted it
 * consumed the Images cell instead of sitting beside it, so the body carried
 * six cells under seven headers and every value rendered one column to the
 * left. Images showed the fuel, Fuel showed the price, Ex-showroom Price
 * showed the status.
 *
 * Nothing caught it. The build passed — a `<td>` too few is valid HTML. The
 * unit tests passed because they drove the component and never rendered its
 * template. The admin-theme spec passed because it reads stylesheets, not
 * markup. It took a person opening the page.
 *
 * Counting the cells is the cheapest check that would have failed.
 */
describe('AdminPricingComponent — the table lines up', () => {
  it('renders one body cell per header', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminPricingComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const fixture = TestBed.createComponent(AdminPricingComponent);
    const c: any = fixture.componentInstance;

    // One row, straight into the signal the table reads.
    c['cars'].set([{
      id: 'gv-2026', make: 'Maruti Suzuki', model: 'Grand Vitara', variant: null,
      year: 2026, price: 1619000, imageCount: 10,
      fuel: 'electric', editFuel: 'electric',
      editPrice: 1619000, editing: false, saving: false, error: '',
    }]);
    c.loading?.set?.(false);
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const headers = el.querySelectorAll('thead th').length;
    const cells = el.querySelectorAll('tbody tr td').length;

    expect(headers).toBeGreaterThan(0);
    expect(cells)
      .withContext(`${cells} cells under ${headers} headers — the row is shifted`)
      .toBe(headers);
  });
});
