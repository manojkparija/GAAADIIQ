/**
 * A model the catalogue has never heard of can still be photographed.
 *
 * WHAT WAS REPORTED
 *
 * A screenshot of the upload form with the Model dropdown open under Maruti
 * Suzuki. It offered Baleno, Fronx, Grand Vitara, S-Presso and e Vitara, and
 * nothing else — no row for a model that is absent, and no link beside it to
 * type one. "The model name is not there where user can type the other
 * option."
 *
 * WHY THIS IS AN OPTION AND NOT A FEATURE
 *
 * The escape was already designed and three-quarters built. `ADD_NEW` exists,
 * `onIdentityPick()` switches the field to a text box the moment it sees that
 * value, and the text box already carries a "Choose an existing model instead"
 * link back. The YEAR picker has offered "➕ Add new year…" all along and works
 * exactly this way.
 *
 * Make, model and variant were simply never given the row. So the only route
 * into their text boxes was `loadCatalogue()` failing outright, which sets all
 * three to custom — and that is a path nobody hits on a working deployment.
 * The feature was there; the door to it was not.
 *
 * The upload itself never required a catalogue row (see the note on
 * `researchAvailable`), so a typed model was always accepted by the API. It
 * just could not be typed.
 *
 * WHAT THESE TESTS PIN
 *
 * That the existing selection path is untouched — the same models, in the same
 * order, still selecting the same way — and that the new row is the LAST one,
 * so it cannot be hit by accident by someone reaching for the model above it.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { AdminCarImagesComponent } from './admin-car-images.component';

function mount(): AdminCarImagesComponent {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AdminCarImagesComponent, RouterTestingModule],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  const c = TestBed.createComponent(AdminCarImagesComponent).componentInstance;
  // The catalogue as the reported screenshot had it.
  (c as any).catalogue.set([
    { make: 'Maruti Suzuki', model: 'Baleno', variant: 'Zeta', ex_showroom_price: 700000 },
    { make: 'Maruti Suzuki', model: 'Fronx', variant: null, ex_showroom_price: null },
    { make: 'Maruti Suzuki', model: 'S-Presso', variant: null, ex_showroom_price: null },
    { make: 'Tata', model: 'Nexon', variant: null, ex_showroom_price: 800000 },
  ]);
  return c;
}

describe('AdminCarImagesComponent — typing a model the catalogue lacks', () => {
  it('offers a way out of the manufacturer list', () => {
    const c = mount();
    const labels = c.makeSelectOptions().map(o => o.label);

    expect(labels).toContain('➕ Add new manufacturer…');
  });

  it('offers a way out of the model list', () => {
    // The reported case exactly.
    const c = mount();
    c.onIdentityPick('make', 'Maruti Suzuki');

    const labels = c.modelSelectOptions().map(o => o.label);
    expect(labels).toContain('➕ Add new model…');
  });

  it('offers a way out of the variant list', () => {
    const c = mount();
    c.onIdentityPick('make', 'Maruti Suzuki');
    c.onIdentityPick('model', 'Baleno');

    expect(c.variantSelectOptions().map(o => o.label)).toContain('➕ Add new variant…');
  });

  it('keeps every catalogue model, in order, ahead of it', () => {
    // The half that matters most: this must be an addition to the list, not a
    // change to it. Same models, same order, same values — one extra row at
    // the end.
    const c = mount();
    c.onIdentityPick('make', 'Maruti Suzuki');

    const rows = c.modelSelectOptions();
    expect(rows.slice(0, -1).map(o => o.value))
      .withContext('the existing choices are untouched')
      .toEqual(['Baleno', 'Fronx', 'S-Presso']);
    expect(rows[rows.length - 1].value)
      .withContext('last, so nobody reaching for the model above it hits it')
      .toBe(c.ADD_NEW);
  });

  it('still selects an existing model exactly as before', () => {
    const c = mount();
    c.onIdentityPick('make', 'Maruti Suzuki');
    c.onIdentityPick('model', 'Baleno');

    expect(c.model()).toBe('Baleno');
    expect(c.customModel())
      .withContext('picking a real model must not open the text box')
      .toBeFalse();
  });

  it('switches to a text box when the new row is picked, and empties the field', () => {
    const c = mount();
    c.onIdentityPick('make', 'Maruti Suzuki');
    c.onIdentityPick('model', 'Baleno');

    c.onIdentityPick('model', c.ADD_NEW);

    expect(c.customModel()).toBeTrue();
    expect(c.model())
      .withContext('the previous pick must not be left behind in the text box')
      .toBe('');
  });

  it('does not offer the row on the browse-existing filter', () => {
    // That dropdown picks a vehicle whose photographs are already stored, so
    // "add new" there would offer to filter by a manufacturer with none.
    const c = mount();
    expect(c.makeOptions()).toEqual(['Maruti Suzuki', 'Tata']);
    expect(c.makeOptions() as unknown as string[])
      .not.toContain(c.ADD_NEW);
  });
});
