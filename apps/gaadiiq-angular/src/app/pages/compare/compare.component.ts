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

  specRows = [
    { label: 'Price', key: 'price', format: (v: any) => `₹${(+v/100000).toFixed(1)}L`, higher: false },
    { label: 'Year', key: 'year', format: (v: any) => String(v), higher: true },
    { label: 'KM Driven', key: 'km', format: (v: any) => `${(+v).toLocaleString()} km`, higher: false },
    { label: 'Fuel Type', key: 'fuel', format: (v: any) => String(v), higher: null },
    { label: 'Transmission', key: 'transmission', format: (v: any) => String(v), higher: null },
    { label: 'Owners', key: 'owners', format: (v: any) => String(v) || '—', higher: null },
    { label: 'Rating', key: 'rating', format: (v: any) => `${v} ★`, higher: true },
    { label: 'Reviews', key: 'reviews', format: (v: any) => String(v), higher: true },
    { label: 'City', key: 'city', format: (v: any) => String(v) || '—', higher: null },
  ];

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
        // Prefer a row with a photograph. A key saved before the model's
        // images were removed would otherwise reopen a blank card, and the
        // compare page would keep showing what the rest of the site stopped.
        const matches = cars.filter(c => c.make === make && c.model === model);
        const car = matches.find(c => c.km === 0 && c.year >= 2024 && isShowable(c))
          ?? matches.find(isShowable)
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
   * What the picker offers.
   *
   * Catalogue rows with no photograph are left out, as they are on the New
   * Cars and Browse grids. Comparing two blank cards is not a comparison, and
   * offering a car the rest of the site has stopped showing contradicts it.
   * Adverts stay: see isShowable.
   */
  filtered(slot: number) {
    const q = this.search(slot).toLowerCase();
    const all = this.carsData.cars().filter(isShowable);
    if (!q) return all.slice(0, 10);
    return all.filter(c => `${c.make} ${c.model} ${c.year}`.toLowerCase().includes(q)).slice(0, 8);
  }

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

  entryFeatures(e: CompareEntry): string[] {
    return e.variant?.features?.length ? e.variant.features : (e.car.features || []);
  }

  entryHasFeature(e: CompareEntry, feature: string): boolean {
    return this.entryFeatures(e).some(f => f.toLowerCase().includes(feature.toLowerCase()));
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

  isEntryWinner(key: string, e: CompareEntry, higher: boolean | null): boolean {
    if (higher === null) return false;
    const entries = this.activeEntries();
    if (entries.length < 2) return false;
    const vals = entries.map(x => parseFloat(String(this.getEntryVal(x, key))));
    const mine = parseFloat(String(this.getEntryVal(e, key)));
    if (isNaN(mine)) return false;
    return higher ? mine === Math.max(...vals) : mine === Math.min(...vals);
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
