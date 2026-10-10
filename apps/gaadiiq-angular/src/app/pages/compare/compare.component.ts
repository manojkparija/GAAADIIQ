import { Component, signal, computed, OnInit, inject } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CarsDataService, Car, CarVariant, isShowable, startingPrice } from '../../services/cars-data.service';
import { TcoService, TcoBreakdown } from '../../services/tco.service';
import { SeoService } from '../../services/seo.service';
import { IconComponent } from '../../components/icon/icon.component';
import { TranslatePipe } from '../../pipes/translate.pipe';

const COMPARE_KEY = 'gaadiiq_compare_keys';

/**
 * One column of the table: a car, and optionally which of its trims.
 *
 * The table used to iterate `activeCars()` and pass a Car to every accessor.
 * That cannot express the comparison this page is for — a model's top trim
 * against its mid trim — because both columns would be the same Car object and
 * nothing downstream could tell them apart. So the column is a slot, not a car.
 */
export interface CompareEntry {
  slot: number;
  car: Car;
  variant: CarVariant | null;
}

/**
 * The fuels TcoService prices.
 *
 * A trim's fuel_type is free text, deliberately — "Petrol + CNG" is a real
 * answer no enum holds. TcoService keys its per-km, maintenance and
 * depreciation tables off exact strings and falls back to a flat default on
 * anything else, so feeding it that string would quietly re-cost the car on a
 * number that means "unrecognised" rather than "this fuel". A trim's fuel is
 * used for the arithmetic only when it names one of these exactly; otherwise
 * the catalogue row's fuel stands. The Fuel Type ROW still displays the trim's
 * own text, because that is reporting, not costing.
 */
const TCO_FUELS = ['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid'];

@Component({
  selector: 'app-compare',
  standalone: true,
  imports: [RouterLink, CommonModule, FormsModule, IconComponent, TranslatePipe],
  templateUrl: './compare.component.html',
  styleUrl: './compare.component.scss'
})
export class CompareComponent implements OnInit {
  searchA = signal(''); searchB = signal(''); searchC = signal('');
  selected = signal<(Car | null)[]>([null, null, null]);
  showDropdown = signal<number>(-1);

  /**
   * Which trim each slot is quoting, parallel to `selected`.
   *
   * Parallel rather than folded into `selected` on purpose: `selected` is the
   * page's existing contract — the saved-keys restore writes it, and three
   * spec files set and read it directly. A null here means "no trim chosen",
   * and every figure then comes from exactly the code path it came from
   * before, so the table a buyer who never touches the picker sees is
   * unchanged down to the rupee.
   */
  trims = signal<(CarVariant | null)[]>([null, null, null]);

  /** The published trims offered in each slot, [] until they arrive or if none. */
  trimOptions = signal<CarVariant[][]>([[], [], []]);

  /**
   * One request per car, not per slot.
   *
   * Comparing a model's top trim against its mid trim puts the SAME car in two
   * slots, which is the whole point of this feature and would otherwise fetch
   * the same list twice. The promise is cached rather than the rows, so two
   * slots filled in the same tick share one in-flight request.
   */
  private trimsByCar = new Map<string, Promise<CarVariant[]>>();

  /**
   * `String(v) || '—'` does not do what it reads like, and this table shipped
   * four cells proving it.
   *
   * `String(undefined)` is the five-character string "undefined", which is
   * truthy — so the `|| '—'` branch never ran, and Owners and City printed the
   * word `undefined` on every comparison of catalogue cars, which carry neither
   * field. The em-dash fallback was written and had never once been reached.
   *
   * `dash()` tests the VALUE before stringifying it, which is the only order
   * that works. Applied to every row, not just the two that were visibly wrong:
   * a seller's advert can be missing a rating or a fuel type just as easily, and
   * those formatters had the same latent fault.
   */
  private static dash(v: any, fmt: (v: any) => string): string {
    if (v === null || v === undefined || v === '') return '—';
    return fmt(v);
  }

  specRows = [
    { label: 'Price', key: 'price', format: (v: any) => CompareComponent.dash(v, x => `₹${(+x/100000).toFixed(1)}L`), higher: false },
    { label: 'Year', key: 'year', format: (v: any) => CompareComponent.dash(v, String), higher: true },
    { label: 'KM Driven', key: 'km', format: (v: any) => CompareComponent.dash(v, x => `${(+x).toLocaleString()} km`), higher: false },
    { label: 'Fuel Type', key: 'fuel', format: (v: any) => CompareComponent.dash(v, String), higher: null },
    { label: 'Transmission', key: 'transmission', format: (v: any) => CompareComponent.dash(v, String), higher: null },
    { label: 'Owners', key: 'owners', format: (v: any) => CompareComponent.dash(v, String), higher: null },
    { label: 'Rating', key: 'rating', format: (v: any) => CompareComponent.dash(v, x => `${x} ★`), higher: true },
    { label: 'Reviews', key: 'reviews', format: (v: any) => CompareComponent.dash(v, String), higher: true },
    { label: 'City', key: 'city', format: (v: any) => CompareComponent.dash(v, String), higher: null },
  ];

  /**
   * specRows minus the ones that would only state a zero.
   *
   * Rating and Reviews rendered "0 ★" and "0" for every car on the page.
   * dash() turns null and '' into an em dash but 0 is a number, so it passed
   * straight through and the table asserted a rating of zero on cars nobody
   * has rated.
   *
   * The card grids stopped doing this when the guard went into
   * new-cars.component.html and car-card.component.html; the comparison
   * table was the one place still doing it, which is the place a reader is
   * most likely to be weighing one car against another.
   *
   * Both mappers in cars-data.service.ts hardcode `reviews: 0`, so today this
   * hides the rows everywhere. That is the honest result while no rating data
   * exists, and the rows come back on their own the day the API sends any.
   */
  visibleSpecRows() {
    const anyReviewed = this.activeEntries()
      .some(e => Number(this.getEntryVal(e, 'reviews')) > 0);
    if (anyReviewed) return this.specRows;
    return this.specRows.filter(r => r.key !== 'rating' && r.key !== 'reviews');
  }

  constructor(
    public carsData: CarsDataService,
    private seo: SeoService,
    public tco: TcoService,
    private route: ActivatedRoute,
  ) {
    seo.setPage('Compare Cars', 'Compare up to 3 cars side by side. Specs, features, price, AI valuation — all in one place.');
  }

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      let keys: string[] = [];
      if (params['keys']) {
        keys = String(params['keys']).split(',').map(k => k.trim()).filter(Boolean);
      } else {
        try {
          const raw = sessionStorage.getItem(COMPARE_KEY);
          if (raw) keys = JSON.parse(raw);
        } catch { /* ignore */ }
      }
      if (!keys.length) return;

      const cars = this.carsData.cars();
      const picked: (Car | null)[] = [null, null, null];
      let slot = 0;
      for (const key of keys) {
        if (slot >= 3) break;
        const [make, model] = key.split('||');
        // Prefer a row with a photograph, but never refuse to restore one.
        //
        // The last fallback is new, and it is the other half of letting the
        // picker offer unphotographed models. Without it a reader could build
        // a comparison, save it, and reopen it to find that column silently
        // gone — selectable but not restorable, which is a worse state than
        // either rule on its own.
        const matches = cars.filter(c => c.make === make && c.model === model);
        const car = matches.find(c => c.km === 0 && c.year >= 2024 && isShowable(c))
          ?? matches.find(isShowable)
          ?? matches.find(c => c.km === 0 && c.year >= 2024)
          ?? matches[0]
          ?? null;
        if (car) {
          picked[slot] = car;
          slot++;
        }
      }
      if (slot > 0) {
        this.selected.set(picked);
        // A restored slot gets its trim picker too, or reopening a saved
        // comparison would silently offer less than building it fresh does.
        picked.forEach((car, i) => { if (car) void this.loadTrims(i, car); });
      }
    });
  }

  search(slot: number) {
    return [this.searchA, this.searchB, this.searchC][slot]();
  }

  popularPicks = computed(() => {
    const seen = new Set<string>();
    const picks: Car[] = [];
    for (const c of this.carsData.cars().filter(isShowable)) {
      if (!seen.has(c.make)) { seen.add(c.make); picks.push(c); }
      if (picks.length === 6) break;
    }
    return picks;
  });

  /**
   * How many cars the picker shows before the reader has typed anything.
   *
   * Only the unprompted list is capped. A search is not: asked for "maruti",
   * the picker returns every Maruti. See filtered().
   */
  static readonly UNPROMPTED_SUGGESTIONS = 20;

  /**
   * Every car in the catalogue, not only the photographed ones.
   *
   * REPORTED: typing "maruti" offered four models, and "All the models are not
   * coming in the dropdown".
   *
   * This used to filter by isShowable, which hides a catalogue row that has no
   * photograph. That rule is right on the New Cars and Browse grids, where a
   * card without a picture is a blank tile — the comment here even cited them.
   * It is wrong on this surface, and the markup says why:
   *
   *     <div class="drop-item" ...>
   *       <span>{{ c.year }} {{ c.make }} {{ c.model }}</span>
   *       <span class="drop-price">{{ formatPrice(startsAt(c)) }}</span>
   *
   * There is no image in a suggestion. The photograph rule was costing the
   * reader most of the catalogue to protect them from a picture that is never
   * drawn. And the table they land on already falls back to
   * assets/cars/placeholder.svg, so a model without a photo compares fine — it
   * simply could not be found.
   *
   * The old comment argued that offering a car "the rest of the site has
   * stopped showing contradicts it". The contradiction runs the other way:
   * Compare says "Search any car from our database", and then could not find
   * most of them.
   *
   * A SEARCH IS NOT CAPPED
   *
   * It used to stop at eight, silently. Asked for "maruti" the reader must get
   * every Maruti, because a list that quietly stops cannot be told apart from
   * a catalogue that is short — which is the same confusion as the photograph
   * rule, one order of magnitude smaller. Only the unprompted list is capped,
   * where the cars shown are arbitrary anyway and the full catalogue would be
   * noise rather than an answer.
   *
   * The dropdown scrolls (see .search-dropdown in the stylesheet); before this
   * it had no max-height, so a long list would have run off the page.
   */
  filtered(slot: number) {
    const q = this.search(slot).toLowerCase();
    const all = this.carsData.cars().filter(c => !this.isInAnotherSlot(slot, c));
    if (!q) return all.slice(0, CompareComponent.UNPROMPTED_SUGGESTIONS);
    return all.filter(c => `${c.make} ${c.model} ${c.year}`.toLowerCase().includes(q));
  }

  /**
   * Already sitting in one of the other two slots.
   *
   * Reported with Hyundai Creta in columns 2 and 3: identical price, year,
   * odometer, fuel and transmission, so every row matched and the table said
   * nothing. A car compared against itself cannot inform anybody.
   *
   * THE GUARD IS HERE AND NOT IN selectCar(), DELIBERATELY
   *
   * compareTrims() calls selectCar() with a car that IS already in another slot
   * — that is the whole of "Compare its variants", which puts one model in two
   * columns so two trims of it can be read side by side. A duplicate check
   * inside selectCar would have deleted that feature while appearing to fix a
   * bug. Filtering the dropdown blocks the accident and leaves the deliberate
   * path alone.
   *
   * Matching on id, not on make+model: two catalogue rows for one model that
   * differ in fuel or transmission are a comparison worth making, and
   * optionLabel() below is what makes them tellable apart.
   */
  private isInAnotherSlot(slot: number, car: Car): boolean {
    return this.selected().some((c, i) => i !== slot && c?.id === car.id);
  }

  /**
   * What a dropdown row says.
   *
   * The list used to render `{year} {make} {model}` and a price, which is
   * ambiguous the moment the catalogue holds two rows for one model-year — they
   * appear as two identical lines, and picking "the other one" is guesswork.
   * That became reachable when the picker stopped filtering to photographed
   * cars, so this is the other half of that change.
   *
   * The discriminator is only added when it is needed: the first field that
   * actually differs from the other rows sharing this model-year. A catalogue
   * where every Creta row is distinct reads exactly as it did before.
   */
  optionLabel(car: Car, list: Car[]): string {
    const base = `${car.year} ${car.make} ${car.model}`;
    const twins = list.filter(
      c => c.id !== car.id && `${c.year} ${c.make} ${c.model}` === base,
    );
    if (!twins.length) return base;

    for (const field of ['fuel', 'transmission', 'bodyType'] as const) {
      const mine = (car as any)[field];
      if (mine && twins.some(t => (t as any)[field] !== mine)) {
        return `${base} · ${mine}`;
      }
    }
    // Nothing distinguishes them. Say so rather than printing the same line
    // twice as though they were different cars — two identical rows in the
    // catalogue is a data problem, and silently hiding one would bury it.
    return `${base} · same spec`;
  }

  /** Every car the picker can reach — the honest size of "our database". */
  searchableCount = computed(() => this.carsData.cars().length);

  selectCar(slot: number, car: Car) {
    this.selected.update(arr => { const n = [...arr]; n[slot] = car; return n; });
    // A new car in the slot cannot keep the old car's trim.
    this.setTrim(slot, null);
    [this.searchA, this.searchB, this.searchC][slot].set('');
    this.showDropdown.set(-1);
    void this.loadTrims(slot, car);
  }

  removeCar(slot: number) {
    this.selected.update(arr => { const n = [...arr]; n[slot] = null; return n; });
    this.setTrim(slot, null);
    this.trimOptions.update(all => { const n = [...all]; n[slot] = []; return n; });
  }

  // ── Trims ─────────────────────────────────────────────────────────────────

  /**
   * Fetch the trims for a slot's car.
   *
   * `variantsFor` is called optionally because three spec files provide a
   * CarsDataService stub that carries `cars`, `loading` and `failedSources`
   * and nothing else. Calling a method that is not there would throw inside
   * selectCar and take out tests that have nothing to do with trims.
   *
   * Anything that fails lands as [], and a slot with no trims renders exactly
   * as it did before this existed. That covers the cases that legitimately
   * have none: a seller's advert is one car at one price, and the demo rows
   * carry ids the API has never heard of.
   */
  private async loadTrims(slot: number, car: Car) {
    const rows = await this.trimsFor(car);
    // The slot may have been changed or cleared while this was in flight.
    if (this.selected()[slot]?.id !== car.id) return;
    this.trimOptions.update(all => { const n = [...all]; n[slot] = rows; return n; });
  }

  private trimsFor(car: Car): Promise<CarVariant[]> {
    const cached = this.trimsByCar.get(car.id);
    if (cached) return cached;
    const pending = Promise.resolve(this.carsData.variantsFor?.(car.id) ?? [])
      .catch(() => [] as CarVariant[]);
    this.trimsByCar.set(car.id, pending);
    return pending;
  }

  setTrim(slot: number, variant: CarVariant | null) {
    this.trims.update(arr => { const n = [...arr]; n[slot] = variant; return n; });
  }

  /** The `<select>` hands back an id; '' is "all trims", the original behaviour. */
  setTrimById(slot: number, id: string) {
    this.setTrim(slot, this.trimOptions()[slot].find(v => v.id === id) ?? null);
  }

  /**
   * Put the same car in the next free slot, so its trims can be compared.
   *
   * Selecting one car twice was always possible — neither the dropdown nor the
   * popular picks ever excluded what was already chosen — but nothing said so,
   * and two identical untrimmed columns look like a bug rather than a feature.
   */
  compareTrims(slot: number) {
    const car = this.selected()[slot];
    if (!car) return;
    const free = this.selected().findIndex(c => !c);
    if (free === -1) return;
    this.selectCar(free, car);
  }

  canCompareTrims(slot: number): boolean {
    return this.trimOptions()[slot].length >= 2 && this.selected().some(c => !c);
  }

  /**
   * The value a spec row compares.
   *
   * `price` is redirected to the entry trim, because the row's own figure is
   * not a price the car is sold at — and this row awards a crown, so comparing
   * on it declares a winner between two numbers that do not exist.
   */
  getVal(car: Car, key: string): any {
    return key === 'price' ? this.startsAt(car) : (car as any)[key];
  }

  isWinner(key: string, car: Car, higher: boolean | null): boolean {
    if (higher === null) return false;
    const sel = this.selected().filter(Boolean) as Car[];
    if (sel.length < 2) return false;
    // Through getVal, so the crown is decided on the same number the row
    // displays rather than on the raw field beside it.
    const vals = sel.map(c => parseFloat(String(this.getVal(c, key))));
    const myVal = parseFloat(String(this.getVal(car, key)));
    if (isNaN(myVal)) return false;
    return higher ? myVal === Math.max(...vals) : myVal === Math.min(...vals);
  }

  activeCars = computed(() => this.selected().filter(Boolean) as Car[]);
  minTco = computed(() => Math.min(...this.activeCars().map(c => this.tco.calculateTco(c).netCost5yr)));

  // ── The table's columns ───────────────────────────────────────────────────
  //
  // Every accessor below takes an entry and falls through to the car-based
  // function above it whenever no trim is chosen. That fallthrough is the
  // guarantee: with the picker untouched these return what the old functions
  // returned, because they ARE the old functions.

  activeEntries = computed<CompareEntry[]>(() => {
    const trims = this.trims();
    const out: CompareEntry[] = [];
    this.selected().forEach((car, slot) => {
      if (car) out.push({ slot, car, variant: trims[slot] ?? null });
    });
    return out;
  });

  /** Any trim chosen anywhere — the table grows its trim-only rows only then. */
  comparingTrims = computed(() => this.activeEntries().some(e => e.variant !== null));

  /**
   * What this column costs.
   *
   * A trim with no price yet is NULL in the column, and rendering that as zero
   * would hand it every crown on the page and drag the five-year block down
   * with it. An unpriced trim falls back to the model's starting price, which
   * is the same figure the column showed before a trim was picked.
   */
  entryPrice(e: CompareEntry): number {
    const raw = e.variant?.ex_showroom_price;
    const price = raw == null ? NaN : Number(raw);
    return Number.isFinite(price) && price > 0 ? price : this.startsAt(e.car);
  }

  /** The slot card's own figure, which is the trim's price once one is chosen. */
  slotPrice(slot: number, car: Car): number {
    return this.entryPrice({ slot, car, variant: this.trims()[slot] ?? null });
  }

  entryFuel(e: CompareEntry): string {
    return e.variant?.fuel_type?.trim() || e.car.fuel;
  }

  entryTransmission(e: CompareEntry): string {
    return e.variant?.transmission?.trim() || e.car.transmission;
  }

  entryName(e: CompareEntry): string {
    return `${e.car.make} ${e.car.model}`;
  }

  entryTrimName(e: CompareEntry): string {
    return e.variant?.name ?? '';
  }

  /**
   * The trim's features AND the model's, not one or the other.
   *
   * This used to prefer the trim's list whenever it had anything in it, and
   * only fall back to the model's when it was empty. That reads as sensible
   * and is wrong: the lists are not alternatives describing the same thing at
   * different precisions, they are two partial lists written separately. The
   * Brezza's detail page names "6 standard airbags", "Single-pane sunroof"
   * and "360-degree camera" from the MODEL; its ZXi+ AT trim names a handful
   * of others. Choosing the trim's list discarded everything the model knew,
   * so the comparison showed dashes for features the detail page was listing
   * two clicks away.
   *
   * Merging is safe precisely because this table never answers "no". A
   * feature named on the model and absent from the trim's list yields a tick
   * rather than a dash, which is the honest reading: nothing here can tell us
   * the trim dropped it, and the detail page is already telling the reader
   * the model has it.
   */
  entryFeatures(e: CompareEntry): string[] {
    return [...(e.variant?.features ?? []), ...(e.car.features ?? [])];
  }

  /**
   * Matches on words, not on substrings.
   *
   * `'6 standard airbags'.includes('6 airbags')` is false, and so is
   * `'360-degree camera'.includes('360 camera')` and
   * `'Ventilated front seats'.includes('Ventilated Seats')`. Those are the
   * actual strings the Brezza ships with, and all three rendered as "not
   * listed" against labels they plainly satisfy.
   *
   * So each side is split into words, punctuation dropped and a trailing "s"
   * stripped, and a label matches when every one of its words appears. That
   * takes "6 standard airbags" for "6 Airbags" and "360-degree camera" for
   * "360 Camera", while still refusing "wireless Android Auto" for "Wireless
   * Charging" -- which has "wireless" but no "charging", and is a different
   * feature.
   *
   * Requiring EVERY word, rather than any, is what keeps that last one
   * honest. The risk this carries is a false tick from an unlucky
   * combination, and a tick is a claim; it is the reason the matcher is
   * deliberately dumb and literal rather than fuzzy.
   */
  private static words(s: string): string[] {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
      .filter(Boolean)
      .map(w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
  }

  /**
   * Three answers, not two: yes, unknown, and — only where we can honestly
   * say so — no.
   *
   * WHY A CROSS WAS WRONG
   *
   * Reported against the Creta and the Verna, both of which ship six airbags
   * as standard and both of which this table marked with a cross.
   *
   * The cross was never a statement about the car. The six labels below are
   * matched as substrings against `features`, and `features` is free text:
   * services/variant_research.py has a model write it, with "6 Airbags" and
   * "Touchscreen infotainment" as examples rather than as a vocabulary.
   * Nothing constrains it to these spellings, so "Six airbags" or "Airbags
   * (6)" miss, and a miss rendered as a cross. The table was reporting
   * whether a string matched and presenting it as whether a car has a
   * feature.
   *
   * That is the same fault as the Creta's "Hybrid Option" highlight removed
   * in #303 — a specific, checkable claim the page could not source — and it
   * is worse here, because a buyer comparing safety kit is exactly who should
   * not be told a car lacks airbags it has.
   *
   * A car with NO recorded features at all is the one case where absence is
   * itself informative: nothing is known about any of them, so every row is
   * unknown. Where some features are recorded, a miss still cannot be read as
   * absence, because the list is a highlights list rather than a full
   * inventory — nothing promises the Creta's entry names every feature it has.
   *
   * So there is no case here where a cross is justified, and it is gone. A
   * dash matches what the rows above already do for an unknown owner count or
   * city.
   */
  entryFeatureState(e: CompareEntry, feature: string): 'yes' | 'unknown' {
    const want = CompareComponent.words(feature);
    const has = this.entryFeatures(e).some(f => {
      const got = new Set(CompareComponent.words(f));
      return want.every(w => got.has(w));
    });
    return has ? 'yes' : 'unknown';
  }

  getEntryVal(e: CompareEntry, key: string): any {
    switch (key) {
      case 'price': return this.entryPrice(e);
      case 'fuel': return this.entryFuel(e);
      case 'transmission': return this.entryTransmission(e);
      // year, km, owners, rating, reviews, city describe the catalogue row or
      // the advert. A trim has no such thing, so they are read where they were.
      default: return this.getVal(e.car, key);
    }
  }

  /**
   * Whether this cell is the best in its row — the green shading and the crown.
   *
   * A WINNER EVERYONE WINS IS NOT A WINNER
   *
   * Reported from /compare with three new cars side by side: Year, KM Driven,
   * Rating and Reviews were all shaded green with a crown in every column. The
   * old test was `mine === Math.max(...vals)`, and when every value is equal
   * every value IS the max, so all three were crowned.
   *
   * That is not cosmetic. Catalogue rows all carry year 2026, km 0, rating 0
   * and reviews 0, so comparing any three new cars crowned four rows at once —
   * and a crown on `0 ★` tells the reader that having no ratings is the thing
   * to want. Price was the only row that behaved, because its values genuinely
   * differ, which is what made the rest look wrong beside it.
   *
   * So: a row where nothing distinguishes the cars has no winner. The test is
   * on the SPREAD, not on the individual value.
   *
   * NaNs are dropped rather than poisoning the row. `Math.max(NaN, 5)` is NaN
   * and compares false against everything, so one unparseable cell used to
   * silently remove the crown from a row that had a real winner.
   */
  isEntryWinner(key: string, e: CompareEntry, higher: boolean | null): boolean {
    if (higher === null) return false;
    const entries = this.activeEntries();
    if (entries.length < 2) return false;

    const vals = entries
      .map(x => parseFloat(String(this.getEntryVal(x, key))))
      .filter(v => !isNaN(v));
    if (vals.length < 2) return false;

    const best = higher ? Math.max(...vals) : Math.min(...vals);
    // Every car agrees, so there is nothing to crown.
    if (best === (higher ? Math.min(...vals) : Math.max(...vals))) return false;

    const mine = parseFloat(String(this.getEntryVal(e, key)));
    return !isNaN(mine) && mine === best;
  }

  /**
   * Rows that only mean something once trims are being compared.
   *
   * Hidden otherwise, so a two-car comparison by someone who never opened the
   * picker is the table it has always been rather than three new rows of "—".
   * The fallback reads the catalogue row's own spec list, whose labels are free
   * text from the admin screen, hence the substring match.
   */
  trimRows: { label: string; value: (e: CompareEntry) => string }[] = [
    {
      label: 'Engine',
      value: (e) => e.variant?.engine_cc ? `${e.variant.engine_cc} cc` : this.specOf(e.car, 'engine'),
    },
    {
      label: 'Seating',
      value: (e) => e.variant?.seating_capacity
        ? String(e.variant.seating_capacity)
        : this.specOf(e.car, 'seating'),
    },
    {
      label: 'Mileage',
      value: (e) => e.variant?.mileage?.trim() || this.specOf(e.car, 'mileage'),
    },
  ];

  private specOf(car: Car, label: string): string {
    const hit = (car.specs || []).find(s => s.label.toLowerCase().includes(label));
    return hit?.value || '—';
  }

  hasFeature(car: Car, feature: string): boolean {
    return (car.features || []).some(ft => ft.toLowerCase().includes(feature.toLowerCase()));
  }

  formatPrice(p: number) { return `₹${(p/100000).toFixed(1)}L`; }

  /**
   * What a car on this page costs from.
   *
   * Comparing two cars on the catalogue row's figure compares two numbers
   * neither is sold at — the Fronx row reads ₹9.3L against an entry trim of
   * ₹6.84L. An advert has no trims, so this is its own price, which is right:
   * a used car is one car at one price.
   */
  startsAt(car: Car) { return startingPrice(car); }


  /**
   * A comparison row without a picture is hard to read, and most catalogue
   * cars carry no image of their own — so fall back to the manufacturer's
   * brochure photography before the placeholder.
   */
  optimisedImageFor(car: Car): string {
    return this.optimisedImage(
      (car as any)?.image || 'assets/cars/placeholder.svg',
    );
  }

  optimisedImage(url: string): string {
    if (!url) return 'assets/cars/placeholder.svg';
    const match = url.match(/res\.cloudinary\.com\/([^/]+)\/image\/upload\/(?:[^/]+\/)?(.+)/);
    if (match) {
      const [, cloud, publicId] = match;
      return `https://res.cloudinary.com/${cloud}/image/upload/f_auto,q_auto,w_600,h_380,c_fill/${publicId}`;
    }
    return url;
  }

  onImgLoad(e: Event) { (e.target as HTMLImageElement).style.opacity = '1'; }
  onImgError(e: Event) {
    const img = e.target as HTMLImageElement;
    img.onerror = null;
    img.src = 'assets/cars/placeholder.svg';
    img.style.opacity = '1';
  }

  /**
   * Five-year cost, priced from the trim the page is quoting.
   *
   * Registration, insurance and resale are all percentages of the purchase
   * price, so an error there is multiplied through the whole table rather than
   * carried.
   */
  getTco(car: Car): TcoBreakdown {
    return this.tco.calculateTco({ ...car, price: this.startsAt(car) });
  }

  /**
   * The same five-year cost, priced from the trim this column is quoting.
   *
   * Registration, insurance and resale are percentages of the purchase price,
   * so choosing a top trim over a mid one moves every line here — which is
   * most of what a buyer weighing two trims wants to see.
   */
  getEntryTco(e: CompareEntry): TcoBreakdown {
    return this.tco.calculateTco({
      ...e.car,
      price: this.entryPrice(e),
      fuel: this.tcoFuel(e),
    });
  }

  /** See TCO_FUELS: a trim's free-text fuel is used only when it names one. */
  private tcoFuel(e: CompareEntry): string {
    const declared = (e.variant?.fuel_type || '').trim();
    return TCO_FUELS.find(f => f.toLowerCase() === declared.toLowerCase()) ?? e.car.fuel;
  }

  minEntryTco = computed(
    () => Math.min(...this.activeEntries().map(e => this.getEntryTco(e).netCost5yr)),
  );
  tcoRows: { label: string; key: keyof TcoBreakdown }[] = [
    { label: 'Purchase Price', key: 'purchasePrice' },
    { label: 'Registration (9%)', key: 'registration' },
    { label: 'Insurance (5yr)', key: 'insurance5yr' },
    { label: 'Fuel Cost (5yr)', key: 'fuel5yr' },
    { label: 'Maintenance (5yr)', key: 'maintenance5yr' },
    { label: '5yr Resale Value', key: 'resaleValue' },
    { label: 'Net 5-yr Cost', key: 'netCost5yr' },
  ];
}
