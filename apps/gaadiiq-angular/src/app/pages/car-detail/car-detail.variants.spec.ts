/**
 * Choosing a trim by gearbox, and what the Overview says about a new car.
 *
 * Both reported from UAT.
 *
 * The gearbox filter: a buyer who wants an automatic should not have to read
 * every trim to find which ones are. The filter is built from the trims that
 * exist rather than a fixed list of every transmission on the market, because
 * offering CVT on a car with no CVT produces an empty list the buyer cannot
 * distinguish from a broken page.
 *
 * The Overview: it rendered two facts on a new car — Fuel and Gearbox —
 * because every other pill was conditional on Owners, Colour or Location, and
 * a catalogue model carries none of the three. The facts it does carry were
 * only ever shown on the Specs tab.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { CarDetailComponent } from './car-detail.component';

const variant = (id: string, name: string, transmission: string, price: number) =>
  ({ id, name, transmission, ex_showroom_price: String(price), fuel_type: 'Petrol' }) as any;

describe('CarDetailComponent — gearbox filter', () => {
  let c: CarDetailComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CarDetailComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    c = TestBed.createComponent(CarDetailComponent).componentInstance;
    c.variants.set([
      variant('1', 'Sigma', 'Manual', 650000),
      variant('2', 'Delta', 'Manual', 780000),
      variant('3', 'Zeta AMT', 'AMT', 890000),
      variant('4', 'Alpha CVT', 'CVT', 1150000),
    ]);
  });

  it('offers only the gearboxes this model is sold with', () => {
    // Not a fixed list of every transmission on the market.
    expect(c.gearboxOptions()).toEqual(['AMT', 'CVT', 'Manual']);
  });

  it('shows every trim until a gearbox is chosen', () => {
    expect(c.filteredVariants().length).toBe(4);
  });

  it('shows only the trims with the chosen gearbox', () => {
    c.setGearbox('Manual');
    expect(c.filteredVariants().map(v => v.name)).toEqual(['Sigma', 'Delta']);
  });

  it('matches a gearbox regardless of case', () => {
    c.setGearbox('manual');
    expect(c.filteredVariants().length).toBe(2);
  });

  it('prices the band over the filtered trims, not all of them', () => {
    // Quoting the manual's starting price while showing only automatics is
    // worse than showing no band at all.
    c.setGearbox('AMT');
    expect(c.variantPriceRange()).toEqual([890000, 890000]);
  });

  it('drops a selected trim the filter has hidden', () => {
    // Otherwise the on-road panel goes on pricing a car that is no longer on
    // screen.
    c.selectedVariantId.set('4');
    c.setGearbox('Manual');
    expect(c.selectedVariantId()).toBeNull();
  });

  it('keeps a selected trim the filter still shows', () => {
    c.selectedVariantId.set('1');
    c.setGearbox('Manual');
    expect(c.selectedVariantId()).toBe('1');
  });

  it('restores every trim when the filter is cleared', () => {
    c.setGearbox('CVT');
    c.setGearbox('');
    expect(c.filteredVariants().length).toBe(4);
  });
});

describe('CarDetailComponent — Overview facts', () => {
  let c: CarDetailComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CarDetailComponent, RouterTestingModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    c = TestBed.createComponent(CarDetailComponent).componentInstance;
  });

  it('offers the brochure specs as pills', () => {
    c.car = { specs: [
      { label: 'Mileage', value: '21.5 kmpl' },
      { label: 'Power', value: '89 bhp' },
    ] } as any;
    expect(c.overviewSpecs().map(s => s.label)).toEqual(['Mileage', 'Power']);
  });

  it('does not repeat Fuel or Gearbox, which have their own pills', () => {
    c.car = { specs: [
      { label: 'Fuel', value: 'Petrol' },
      { label: 'Gearbox', value: 'Manual' },
      { label: 'Engine', value: '1197 cc' },
    ] } as any;
    expect(c.overviewSpecs().map(s => s.label)).toEqual(['Engine']);
  });

  it('drops a spec with no value rather than showing an empty pill', () => {
    c.car = { specs: [
      { label: 'Mileage', value: '' },
      { label: 'Seating', value: '5' },
    ] } as any;
    expect(c.overviewSpecs().map(s => s.label)).toEqual(['Seating']);
  });

  it('caps the pills so the section stays readable', () => {
    c.car = { specs: Array.from({ length: 9 }, (_, i) => ({ label: `S${i}`, value: 'v' })) } as any;
    expect(c.overviewSpecs().length).toBe(4);
  });

  it('copes with a car that has no specs at all', () => {
    c.car = {} as any;
    expect(c.overviewSpecs()).toEqual([]);
  });

  it('gives each spec an icon, never an empty name', () => {
    for (const label of ['Mileage', 'Power', 'Engine', 'Seating', 'Range', 'Something odd']) {
      expect(c.specIcon(label)).toBeTruthy();
    }
  });
});
