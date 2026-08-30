import { Component, signal, computed, OnInit, ElementRef, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import { CarsDataService, PLACEHOLDER } from '../../services/cars-data.service';
import { BrandsService } from '../../services/brands.service';
import { AuthService } from '../../services/auth.service';

const COMPARE_KEY = 'gaadiiq_compare_keys';
const NOTIFY_KEY = 'gaadiiq_upcoming_notify';
const LUXURY_MIN = 3000000;

/**
 * The top of the budget slider: ₹2 Cr.
 *
 * Also the "no upper bound asked for" value — at the ceiling the filter is
 * treated as unset, which is why it appears in the reset, the chip count and
 * the URL sync as well as on the slider.
 *
 * It was ₹1 Cr here while the Browse page's slider went to ₹2 Cr, so the same
 * site offered two different maximums for the same catalogue. Named rather
 * than repeated: the literal 10000000 also means "one crore" in the two
 * formatters below, and those must not move with this.
 */
const MAX_BUDGET = 20000000;

interface NewCarModel {
  make: string;
  model: string;
  image: string;
  minPrice: number;
  maxPrice: number;
  variantCount: number;
  bodyType: string;
  fuels: string[];
  rating: number;
  reviews: number;
  badge: string;
  representativeId: string;
}

interface NewLaunch {
  make: string;
  model: string;
  price: string;
  launchDate: string;
  launchAt: Date;
  bodyType: string;
  fuel: string;
  image: string;
  isNew: boolean;
}

interface UpcomingCar {
  make: string;
  model: string;
  expectedPrice: string;
  expectedDate: string;
  bodyType: string;
  fuel: string;
  image: string;
}

import { BodyTypeIconComponent } from '../../components/body-type-icon/body-type-icon.component';
import { CustomSelectComponent } from '../../components/custom-select/custom-select.component';
import { TranslatePipe } from '../../pipes/translate.pipe';

interface BudgetRange {
  label: string;
  min: number;
  max: number | null; // null = no upper bound
}

@Component({
  selector: 'app-new-cars',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, BodyTypeIconComponent, CustomSelectComponent, TranslatePipe],
  templateUrl: './new-cars.component.html',
  styleUrl: './new-cars.component.scss'
})
export class NewCarsComponent implements OnInit {
  @ViewChild('modelsSection') modelsSection?: ElementRef<HTMLElement>;

  readonly placeholder = PLACEHOLDER;
  /** The slider's top, for the template. See MAX_BUDGET. */
  readonly maxBudgetCeiling = MAX_BUDGET;


  /**
   * A catalogue entry's own photograph, or the placeholder.
   *
   * A model with no picture shows that it has none. Filling the gap with a
   * brochure image put a manufacturer's stock photograph on a specific car,
   * which is a different vehicle wearing the right badge.
   */
  imageFor(car: { image?: string | null; make?: string; model?: string }): string {
    return car?.image || PLACEHOLDER;
  }

  constructor(
    private carsData: CarsDataService,
    private router: Router,
    private route: ActivatedRoute,
    public brandsService: BrandsService,
    private auth: AuthService,
  ) {}

  get loading() { return this.carsData.loading; }

  /**
   * True when the catalogue could not be fetched, as distinct from a catalogue
   * that answered with nothing.
   *
   * CarsDataService already keeps these apart — fetchAllPages returns null for
   * a source that failed and an empty list for one that had nothing to say, and
   * `failedSources` records which. Nothing read it. Every page turned both into
   * the same empty grid, and the empty state then told the reader to adjust
   * their filters.
   *
   * MEASURED against a stubbed API: a 500, a timeout and a genuinely empty
   * catalogue produced byte-identical screens — "No models found. Try adjusting
   * your filters" in all three. A buyer with no filters set was being asked to
   * clear filters that do not exist, while the actual problem was that the
   * server never answered.
   */
  outage = computed(() => this.carsData.failedSources().length > 0);

  /** Re-fetch after an outage, without making the reader reload the page. */
  retrying = signal(false);
  async retry(): Promise<void> {
    if (this.retrying()) return;
    this.retrying.set(true);
    try { await this.carsData.reload(); }
    finally { this.retrying.set(false); }
  }

  activeHeroTab = signal<'brand' | 'budget' | 'bodytype'>('brand');
  sidebarOpen = signal(false);
  compareSet = signal<Set<string>>(new Set());
  notifyMsg = signal('');

  // Filters for Popular Models (support min + max budget)
  selectedBodyTypes = signal<string[]>([]);
  selectedFuels = signal<string[]>([]);
  selectedTransmissions = signal<string[]>([]);
  minBudget = signal(0);
  maxBudget = signal(MAX_BUDGET);
  selectedSort = signal('Popularity');

  bodyTypeOptions = ['Hatchback', 'Sedan', 'SUV', 'MUV', 'Electric', 'Luxury'];
  fuelOptions = ['Petrol', 'Diesel', 'Electric', 'CNG', 'Hybrid'];
  transmissionOptions = ['Manual', 'Automatic', 'CVT', 'DCT', 'AMT'];
  sortOptions = ['Popularity', 'Price: Low to High', 'Price: High to Low'];

  get brands() { return this.brandsService.brands(); }

  // The icon is drawn in the template, selected by `shape`, rather than being a
  // character in this array.
  //
  // These were emoji (🚗 🚘 🚙 🚐 ⚡ ✨), which is why they looked ordinary: an
  // emoji is rendered by the operating system's font, so the same six cards are
  // flat-and-pastel on Windows, glossy on macOS, and outlined on Android — none
  // of them GAADIIQ's. Worse, 🚗 and 🚘 are near-identical at 2.2rem on Windows,
  // so Hatchback and Sedan were not visually distinguishable at all. Inline SVG
  // renders identically everywhere and inherits the brand colour.
  bodyTypeCards = [
    { name: 'Hatchback', shape: 'hatchback', desc: 'Compact & city-friendly' },
    { name: 'Sedan',     shape: 'sedan',     desc: 'Comfortable & stylish' },
    { name: 'SUV',       shape: 'suv',       desc: 'Powerful & versatile' },
    { name: 'MUV',       shape: 'muv',       desc: 'Space for the family' },
    { name: 'Electric',  shape: 'electric',  desc: 'Future-ready EVs' },
    { name: 'Luxury',    shape: 'luxury',    desc: 'Premium experience' },
  ];

  budgetRanges: BudgetRange[] = [
    { label: 'Under ₹5L', min: 0, max: 500000 },
    { label: '₹5 – 10L', min: 500000, max: 1000000 },
    { label: '₹10 – 15L', min: 1000000, max: 1500000 },
    { label: '₹15 – 20L', min: 1500000, max: 2000000 },
    { label: '₹20 – 30L', min: 2000000, max: 3000000 },
    { label: 'Above ₹30L', min: 3000000, max: null },
  ];

  private allLaunches: NewLaunch[] = [
    { make: 'Tata', model: 'Curvv', price: '₹9.99L onwards', launchDate: 'Oct 2024', launchAt: new Date('2024-10-15'), bodyType: 'SUV', fuel: 'Petrol / Diesel', image: PLACEHOLDER, isNew: true },
    { make: 'Mahindra', model: 'BE 6', price: '₹18.90L onwards', launchDate: 'Feb 2025', launchAt: new Date('2025-02-01'), bodyType: 'SUV', fuel: 'Electric', image: PLACEHOLDER, isNew: true },
    { make: 'Hyundai', model: 'Creta EV', price: '₹17.99L onwards', launchDate: 'Jan 2025', launchAt: new Date('2025-01-15'), bodyType: 'SUV', fuel: 'Electric', image: PLACEHOLDER, isNew: true },
    { make: 'Skoda', model: 'Kylaq', price: '₹7.89L onwards', launchDate: 'Dec 2024', launchAt: new Date('2024-12-10'), bodyType: 'SUV', fuel: 'Petrol', image: PLACEHOLDER, isNew: true },
    { make: 'Maruti Suzuki', model: 'Swift', price: '₹6.49L onwards', launchDate: 'May 2024', launchAt: new Date('2024-05-01'), bodyType: 'Hatchback', fuel: 'Petrol / CNG', image: 'assets/cars/maruti-swift/front.svg', isNew: true },
    { make: 'Kia', model: 'Syros', price: '₹8.99L onwards', launchDate: 'Jan 2025', launchAt: new Date('2025-01-20'), bodyType: 'SUV', fuel: 'Petrol / Diesel', image: PLACEHOLDER, isNew: true },
  ];

  upcomingCars: UpcomingCar[] = [
    { make: 'Tata', model: 'Sierra EV', expectedPrice: '₹25 – 30L', expectedDate: 'Q3 2026', bodyType: 'SUV', fuel: 'Electric', image: PLACEHOLDER },
    { make: 'Mahindra', model: 'XEV 7e', expectedPrice: '₹30 – 40L', expectedDate: 'Q4 2026', bodyType: 'SUV', fuel: 'Electric', image: PLACEHOLDER },
    { make: 'Toyota', model: 'Urban Cruiser', expectedPrice: '₹12 – 18L', expectedDate: 'Q2 2026', bodyType: 'SUV', fuel: 'Hybrid', image: PLACEHOLDER },
    { make: 'Honda', model: 'Elevate Sport', expectedPrice: '₹16 – 22L', expectedDate: 'Q3 2026', bodyType: 'SUV', fuel: 'Petrol', image: PLACEHOLDER },
    { make: 'MG', model: 'Windsor EV Pro', expectedPrice: '₹22 – 28L', expectedDate: 'Q1 2027', bodyType: 'SUV', fuel: 'Electric', image: PLACEHOLDER },
  ];

  expertPicks = [
    { category: 'Best Value', icon: '💰', make: 'Maruti Suzuki', model: 'Fronx', price: '₹7.51L', reason: 'Stellar mileage, feature-rich at this price point', badge: 'Value Pick' },
    { category: 'Best EV', icon: '⚡', make: 'Tata', model: 'Nexon EV', price: '₹14.49L', reason: 'Longest real-world range, excellent after-sales', badge: 'EV Leader' },
    { category: 'Best Family Car', icon: '👨‍👩‍👧', make: 'Kia', model: 'Carens', price: '₹10.49L', reason: '6/7-seater, top safety scores, premium interiors', badge: 'Family Fav' },
  ];

  notifiedCars = signal<Set<string>>(new Set());

  /** Recent launches (last 12 months) — honest copy vs stale “3 months”. */
  newLaunches = computed(() => {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 12);
    return this.allLaunches
      .filter(l => l.launchAt >= cutoff)
      .sort((a, b) => b.launchAt.getTime() - a.launchAt.getTime());
  });

  /**
   * Every model matching the filters, photograph or not.
   *
   * Split from newCarModels so the grid and the "how many did we hide" count
   * come from one computation. The count started life as a signal written
   * from inside the computed, which Angular rejects (NG0600).
   */
  private allModels = computed<NewCarModel[]>(() => {
    const newCars = this.carsData.cars().filter(c => c.km === 0 && c.year >= 2024);
    const map = new Map<string, typeof newCars>();
    for (const c of newCars) {
      const key = `${c.make}||${c.model}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }

    const selBTs = this.selectedBodyTypes();
    const selFuels = this.selectedFuels();
    const selTxs = this.selectedTransmissions();
    const minB = this.minBudget();
    const maxB = this.maxBudget();

    const models: NewCarModel[] = [];
    map.forEach((cars, key) => {
      const [make, model] = key.split('||');
      // Match any variant in the requested budget band
      const inBand = cars.filter(c => c.price >= minB && c.price <= maxB);
      if (inBand.length === 0) return;

      const prices = inBand.map(c => c.price);
      // Which catalogue row this one card stands for.
      //
      // One card covers every model year in the band — a Fronx card can stand
      // for 2024, 2025 and 2026 at once — so it has to choose whose photograph
      // to show. The rule has always been "prefer a row that has one", but the
      // test was `c.image`, and mapCatalogueCar fills `image` with a
      // placeholder for a car that has none. Every row passed, so the first in
      // the band won: a Fronx card showed "No Image Available" from the 2024
      // row while seven photographs sat on the 2026 one.
      //
      // hasPhoto is that same rule, asked properly: an image the card can
      // actually render. Both exclusions match resolveImage below, which
      // discards an aeplcdn URL and returns the placeholder — so preferring
      // such a row would move "View Details" to a car whose photograph is not
      // going to appear either way.
      const hasPhoto = (c: { image?: string | null }) =>
        !!c.image && c.image !== PLACEHOLDER && !c.image.includes('aeplcdn');
      const rep = inBand.find(hasPhoto) ?? inBand[0];
      // Everything the model is actually sold with, trims included.
      //
      // A catalogue row carries one fuel and one gearbox, and the filters read
      // only those. The S-Presso row says Petrol/Manual while its published
      // trims include Automatic and CNG, so ticking Automatic hid a model that
      // has three automatics — and a model filtered out of a grid looks
      // exactly like one that does not exist.
      //
      // The row's own value stays in the set: it is what a model with no trims
      // entered yet has, and dropping it would hide those models instead.
      const fuels = [...new Set([
        ...inBand.map(c => c.fuel),
        ...inBand.flatMap(c => c.variantFuels ?? []),
      ].filter(Boolean))];
      const gearboxes = [...new Set([
        ...inBand.map(c => c.transmission),
        ...inBand.flatMap(c => c.variantTransmissions ?? []),
      ].filter(Boolean))];
      const bodyType = rep.bodyType ?? '';
      const isElectric = fuels.some(f => f.toLowerCase() === 'electric');
      const isLuxury = Math.min(...prices) >= LUXURY_MIN;

      if (selBTs.length > 0) {
        const matchBt = selBTs.some(bt => {
          if (bt === 'Electric') return isElectric;
          if (bt === 'Luxury') return isLuxury;
          return bodyType === bt;
        });
        if (!matchBt) return;
      }
      if (selFuels.length > 0 && !fuels.some(f => selFuels.includes(f))) return;
      if (selTxs.length > 0 && !gearboxes.some(g => selTxs.some(t => g.includes(t)))) return;

      const image = this.resolveImage(make, model, rep.image);

      models.push({
        make, model,
        image,
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        // Published trims, not catalogue rows. A model is one catalogue row,
        // so this said "1 Variant" beside a page listing eight of them.
        variantCount: Math.max(...inBand.map(c => c.variantCount ?? 0), inBand.length),
        bodyType,
        fuels,
        rating: rep.rating,
        reviews: rep.reviews,
        badge: rep.badge,
        representativeId: rep.id,
      });
    });

    return models;
  });

  /**
   * The models the grid shows: those with a photograph.
   *
   * "No Image Available" on a grid of cars reads as a broken page rather than
   * as a catalogue gap, so a model waits until it has a photograph.
   */
  newCarModels = computed<NewCarModel[]>(() => {
    const shown = this.allModels().filter(m => m.image !== PLACEHOLDER);

    const sort = this.selectedSort();
    if (sort === 'Price: Low to High') return shown.sort((a, b) => a.minPrice - b.minPrice);
    if (sort === 'Price: High to Low') return shown.sort((a, b) => b.minPrice - a.minPrice);
    return shown.sort((a, b) => b.reviews - a.reviews);
  });

  /**
   * Models kept off the grid because they have no photograph.
   *
   * An empty grid has two causes needing opposite responses — no model matched
   * the filters (change them) or none has a picture yet (upload one) — and one
   * message for both sends the reader the wrong way.
   */
  hiddenForNoPhoto = computed(
    () => this.allModels().filter(m => m.image === PLACEHOLDER).length,
  );

  activeFiltersCount = computed(() => {
    return this.selectedBodyTypes().length
      + this.selectedFuels().length
      + this.selectedTransmissions().length
      + (this.minBudget() > 0 ? 1 : 0)
      + (this.maxBudget() < MAX_BUDGET ? 1 : 0);
  });

  budgetFilterLabel = computed(() => {
    const min = this.minBudget();
    const max = this.maxBudget();
    if (min > 0 && max >= MAX_BUDGET) return `Above ${this.formatBudgetLabel(min)}`;
    if (min > 0 && max < MAX_BUDGET) return `${this.formatBudgetLabel(min)} – ${this.formatBudgetLabel(max)}`;
    if (max < MAX_BUDGET) return `Max ${this.formatBudgetLabel(max)}`;
    return 'Max Budget: ₹1 Cr';
  });

  ngOnInit() {
    this.loadCompare();
    this.loadNotify();

    this.route.queryParams.subscribe(params => {
      if (params['minPrice'] != null && params['minPrice'] !== '') {
        this.minBudget.set(+params['minPrice']);
        // min-only (e.g. Above ₹30L) ⇒ open upper bound
        if (params['maxPrice'] == null || params['maxPrice'] === '') {
          this.maxBudget.set(100000000);
        }
      }
      if (params['maxPrice'] != null && params['maxPrice'] !== '') {
        this.maxBudget.set(+params['maxPrice']);
      }
      if (params['bodyType']) {
        const bt = String(params['bodyType']);
        if (bt === 'Electric') {
          this.selectedFuels.set(['Electric']);
          this.selectedBodyTypes.set([]);
        } else if (bt === 'Luxury') {
          this.minBudget.set(Math.max(this.minBudget(), LUXURY_MIN));
          this.selectedBodyTypes.set(['Luxury']);
        } else {
          this.selectedBodyTypes.set([bt]);
        }
      }
      if (params['fuel']) {
        this.selectedFuels.set([String(params['fuel'])]);
      }
      // Every param that narrows the list scrolls to it, `fuel` included.
      //
      // `fuel` was missing here, so the Electric Cars entry in the navbar
      // (routerLink="/new-cars" queryParams="{ fuel: 'Electric' }") filtered
      // correctly and then left the reader at the top of the page, looking at
      // the "Explore New Cars" hero. Reported as "it is taking me to Explore
      // New Cars" — the filter had in fact been applied, several screens
      // further down where nobody had reason to look.
      //
      // Listed explicitly rather than testing for any param at all: `keys`
      // and the compare selection also arrive this way and must not yank the
      // page around.
      const narrows = ['make', 'minPrice', 'maxPrice', 'bodyType', 'fuel'];
      if (narrows.some(k => params[k])) {
        setTimeout(() => this.scrollToModels(), 100);
      }
    });
  }

  /**
   * The photograph a model card shows.
   *
   * An uploaded photograph wins over anything bundled with the app. This used
   * to return the bundled Swift illustration for every Swift before it looked
   * at `raw` at all, so photographs uploaded through the admin screens could
   * never reach the grid — and deleting them from the database changed nothing
   * on screen, which is the opposite of what a delete is for.
   *
   * The bundled Swift drawing is gone entirely rather than demoted to a
   * fallback: the database is the only source of a car's photographs, so a
   * Swift with none shows the placeholder like every other model.
   *
   * aeplcdn URLs are still discarded: they are a third party's and frequently
   * dead, and a broken image tag is worse than an honest placeholder.
   */
  private resolveImage(_make: string, _model: string, raw?: string): string {
    if (raw && raw !== PLACEHOLDER && !raw.includes('aeplcdn') && raw.trim()) return raw;
    return PLACEHOLDER;
  }

  private loadCompare() {
    try {
      const raw = sessionStorage.getItem(COMPARE_KEY);
      if (raw) this.compareSet.set(new Set(JSON.parse(raw)));
    } catch { /* ignore */ }
  }

  private saveCompare() {
    sessionStorage.setItem(COMPARE_KEY, JSON.stringify([...this.compareSet()]));
  }

  private loadNotify() {
    try {
      const email = this.auth.currentUser()?.email ?? 'guest';
      const raw = localStorage.getItem(`${NOTIFY_KEY}_${email}`);
      if (raw) this.notifiedCars.set(new Set(JSON.parse(raw)));
    } catch { /* ignore */ }
  }

  private saveNotify() {
    const email = this.auth.currentUser()?.email ?? 'guest';
    localStorage.setItem(`${NOTIFY_KEY}_${email}`, JSON.stringify([...this.notifiedCars()]));
  }

  private scrollToModels() {
    this.modelsSection?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private syncUrl() {
    const qp: Record<string, string | number> = {};
    if (this.minBudget() > 0) qp['minPrice'] = this.minBudget();
    if (this.maxBudget() < MAX_BUDGET) qp['maxPrice'] = this.maxBudget();
    const bts = this.selectedBodyTypes();
    if (bts.length === 1 && bts[0] !== 'Electric' && bts[0] !== 'Luxury') qp['bodyType'] = bts[0];
    if (bts.includes('Luxury')) qp['bodyType'] = 'Luxury';
    const fuels = this.selectedFuels();
    if (fuels.length === 1) qp['fuel'] = fuels[0];
    if (bts.includes('Electric') || fuels.includes('Electric')) qp['fuel'] = 'Electric';
    this.router.navigate([], { relativeTo: this.route, queryParams: qp, replaceUrl: true });
  }

  /** Called from budget slider in template */
  syncUrlFromSlider() {
    this.syncUrl();
  }

  clearBudgetUrl() {
    this.minBudget.set(0);
    this.maxBudget.set(MAX_BUDGET);
    this.syncUrl();
  }

  addAndCompare(key: string, event?: Event) {
    event?.preventDefault();
    const s = new Set(this.compareSet());
    if (!s.has(key) && s.size < 3) s.add(key);
    this.compareSet.set(s);
    this.saveCompare();
    this.goToCompare();
  }

  toggleBodyType(bt: string) {
    if (bt === 'Electric') {
      const fuels = this.selectedFuels();
      this.selectedFuels.set(fuels.includes('Electric') ? fuels.filter(f => f !== 'Electric') : [...fuels, 'Electric']);
      this.selectedBodyTypes.set(this.selectedBodyTypes().filter(x => x !== 'Electric'));
      this.syncUrl();
      return;
    }
    if (bt === 'Luxury') {
      const has = this.selectedBodyTypes().includes('Luxury');
      this.selectedBodyTypes.set(has ? this.selectedBodyTypes().filter(x => x !== 'Luxury') : [...this.selectedBodyTypes(), 'Luxury']);
      if (!has) this.minBudget.set(Math.max(this.minBudget(), LUXURY_MIN));
      this.syncUrl();
      return;
    }
    const current = this.selectedBodyTypes();
    this.selectedBodyTypes.set(
      current.includes(bt) ? current.filter(x => x !== bt) : [...current, bt]
    );
    this.syncUrl();
  }

  toggleFuel(f: string) {
    const current = this.selectedFuels();
    this.selectedFuels.set(
      current.includes(f) ? current.filter(x => x !== f) : [...current, f]
    );
    this.syncUrl();
  }

  toggleTransmission(t: string) {
    const current = this.selectedTransmissions();
    this.selectedTransmissions.set(
      current.includes(t) ? current.filter(x => x !== t) : [...current, t]
    );
  }

  clearAllFilters() {
    this.selectedBodyTypes.set([]);
    this.selectedFuels.set([]);
    this.selectedTransmissions.set([]);
    this.minBudget.set(0);
    this.maxBudget.set(MAX_BUDGET);
    this.selectedSort.set('Popularity');
    this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }

  applyBudget(range: BudgetRange) {
    this.minBudget.set(range.min);
    // Open upper bound for "Above ₹30L" (slider still caps display at ₹1 Cr label)
    this.maxBudget.set(range.max ?? 100000000);
    this.syncUrl();
    this.scrollToModels();
  }

  toggleCompare(key: string, event?: Event) {
    event?.preventDefault();
    event?.stopPropagation();
    const s = new Set(this.compareSet());
    if (s.has(key)) s.delete(key);
    else {
      if (s.size >= 3) {
        this.notifyMsg.set('You can compare up to 3 cars. Remove one first.');
        setTimeout(() => this.notifyMsg.set(''), 2500);
        return;
      }
      s.add(key);
    }
    this.compareSet.set(s);
    this.saveCompare();
  }

  goToCompare() {
    const keys = [...this.compareSet()];
    this.saveCompare();
    this.router.navigate(['/compare'], { queryParams: keys.length ? { keys: keys.join(',') } : {} });
  }

  compareQueryParams() {
    const keys = [...this.compareSet()];
    return keys.length ? { keys: keys.join(',') } : {};
  }

  toggleNotify(key: string) {
    if (!this.auth.currentUser()) {
      this.router.navigate(['/login'], { queryParams: { returnUrl: '/new-cars' } });
      return;
    }
    const s = new Set(this.notifiedCars());
    if (s.has(key)) {
      s.delete(key);
      this.notifyMsg.set('Notification removed.');
    } else {
      s.add(key);
      this.notifyMsg.set('We will notify you when this car launches.');
    }
    this.notifiedCars.set(s);
    this.saveNotify();
    setTimeout(() => this.notifyMsg.set(''), 2500);
  }

  navigateToBrand(brand: string) {
    this.router.navigate(['/listings'], { queryParams: { carType: 'New', make: brand } });
  }

  navigateToBodyType(bodyType: string) {
    // Apply on-page first so Popular Models updates immediately
    if (bodyType === 'Electric') {
      this.selectedFuels.set(['Electric']);
      this.selectedBodyTypes.set([]);
      this.syncUrl();
      this.scrollToModels();
      return;
    }
    if (bodyType === 'Luxury') {
      this.selectedBodyTypes.set(['Luxury']);
      this.minBudget.set(Math.max(this.minBudget(), LUXURY_MIN));
      this.syncUrl();
      this.scrollToModels();
      return;
    }
    this.selectedBodyTypes.set([bodyType]);
    this.syncUrl();
    this.scrollToModels();
  }

  navigateToBudget(range: BudgetRange) {
    this.applyBudget(range);
  }

  formatLakh(p: number) {
    if (p >= 10000000) return `₹${(p / 10000000).toFixed(1)} Cr`;
    return `₹${(p / 100000).toFixed(1)}L`;
  }

  formatPriceRange(min: number, max: number) {
    if (min === max) return `${this.formatLakh(min)} onwards`;
    return `${this.formatLakh(min)} – ${this.formatLakh(max)}`;
  }

  formatBudgetLabel(val: number) {
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(0)} Cr`;
    return `₹${(val / 100000).toFixed(0)}L`;
  }

  stars(rating: number) {
    return Math.round(rating);
  }

  onImgError(ev: Event) {
    const img = ev.target as HTMLImageElement;
    if (img && img.src && !img.src.includes('placeholder.svg')) {
      img.src = PLACEHOLDER;
    }
  }
}
