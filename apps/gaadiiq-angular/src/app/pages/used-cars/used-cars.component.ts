import { Component, signal, computed, OnInit, OnDestroy, AfterViewInit, ElementRef, ViewChild, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import { CarsDataService, Car } from '../../services/cars-data.service';
import { CityService, POPULAR_CITIES } from '../../services/city.service';
import { IconComponent } from '../../components/icon/icon.component';
import { CustomSelectComponent, SelectOption } from '../../components/custom-select/custom-select.component';
import { TranslatePipe } from '../../pipes/translate.pipe';

type PriceVerdict = 'fairDeal' | 'goodPrice' | 'slightlyHigh';

interface UsedCarViewModel extends Car {
  priceVerdict: PriceVerdict;
  formattedKm: string;
  emiEstimate: string;
}

// Maps user-typed / Nominatim-returned aliases to canonical city names
const CITY_ALIAS: Record<string, string> = {
  'bengaluru': 'Bangalore',
  'new town': 'Kolkata',
  'salt lake': 'Kolkata',
  'bidhannagar': 'Kolkata',
  'navi mumbai': 'Mumbai',
  'greater mumbai': 'Mumbai',
  'gurugram': 'Delhi',
  'gurgaon': 'Delhi',
  'noida': 'Delhi',
  'faridabad': 'Delhi',
  'ghaziabad': 'Delhi',
};

/** Snap a raw city name (from geolocation or user input) to nearest popular city. */
function snapToPopularCity(raw: string): string {
  const lower = raw.toLowerCase().trim();
  // Check alias map first
  if (CITY_ALIAS[lower]) return CITY_ALIAS[lower];
  // Check if any popular city name is contained in the raw string
  for (const c of POPULAR_CITIES) {
    if (lower.includes(c.name.toLowerCase())) return c.name;
  }
  return raw; // return as-is; heroCity will just filter normally
}

@Component({
  selector: 'app-used-cars',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent, CustomSelectComponent, TranslatePipe],
  templateUrl: './used-cars.component.html',
  styleUrl: './used-cars.component.scss'
})
export class UsedCarsComponent implements OnInit, AfterViewInit, OnDestroy {
  protected readonly Math = Math;

  constructor(
    private carsData: CarsDataService,
    public cityService: CityService,
    private router: Router,
    private route: ActivatedRoute,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  get loading() { return this.carsData.loading; }

  /**
   * The used listings call failed, as distinct from a catalogue with no used
   * cars in it. Both render zero rows; only one of them is the buyer's problem.
   */
  readonly listingsFailed = this.carsData.usedListingsFailed;

  retryLoad(): void {
    void this.carsData.reload();
  }

  // Hero search fields

  /**
   * The dropdown stores text, so anything numeric is converted at the edge —
   * a string in the list, a number back in the signal. Keeps the filter
   * signals typed the way the rest of the page already reads them.
   */
  makeOptions(): string[] {
    return this.makes().filter(m => m !== 'All');
  }

  yearStrings(): string[] {
    return this.yearOptions.map(String);
  }

  /** Rupee labels over the numeric ceilings the filter actually applies. */
  readonly budgetOptions: SelectOption[] = [
    { value: '500000', label: 'Under ₹5L' },
    { value: '1000000', label: 'Under ₹10L' },
    { value: '1500000', label: 'Under ₹15L' },
    { value: '2000000', label: 'Under ₹20L' },
    { value: '5000000', label: 'Under ₹50L' },
  ];

  heroMake = signal('');
  heroModel = signal('');
  heroBudgetMax = signal(0);
  // heroCity drives filtering; empty = All India
  heroCity = signal('');

  // When true, city filter is suppressed even if CityService has a value.
  // Set when: (a) ngOnInit detects 0 results for the service city, (b) user clicks "Show All India".
  // Cleared when: user explicitly types/picks a city in the hero search.
  allIndiaOverride = signal(false);

  cityOptions = ['Mumbai','Delhi','Bangalore','Hyderabad','Chennai','Kolkata','Pune','Ahmedabad','Jaipur','Rourkela','Lucknow','Chandigarh','Surat','Nagpur','Indore'];

  // Sidebar filters
  sidebarOpen = signal(false);
  minBudget = signal(100000);
  maxBudget = signal(20000000);
  yearFrom = signal(2005);
  yearTo = signal(new Date().getFullYear());
  selectedKmRanges = signal<string[]>([]);
  selectedFuels = signal<string[]>([]);
  selectedTransmissions = signal<string[]>([]);
  selectedBodyTypes = signal<string[]>([]);
  selectedOwners = signal<string[]>([]);
  certifiedOnly = signal(false);
  selectedColors = signal<string[]>([]);

  // Sort & pagination
  selectedSort = signal('Relevance');
  pageSize = signal(12);

  // Wishlist
  wishlist = signal<Set<string>>(new Set());

  // Options
  fuelOptions = ['Petrol', 'Diesel', 'Electric', 'CNG', 'Hybrid'];
  transmissionOptions = ['Manual', 'Automatic', 'CVT', 'DCT', 'AMT'];
  bodyTypeOptions = ['Hatchback', 'Sedan', 'SUV', 'MUV'];
  ownerOptions = ['1st Owner', '2nd Owner', '3rd Owner+'];
  sortOptions = ['Relevance', 'Price: Low to High', 'Price: High to Low', 'Newest First', 'Lowest KM'];
  colorOptions = [
    { name: 'White', hex: '#F8F8F8' }, { name: 'Silver', hex: '#C0C0C0' },
    { name: 'Black', hex: '#1C1C1C' }, { name: 'Grey', hex: '#808080' },
    { name: 'Red', hex: '#C0392B' }, { name: 'Blue', hex: '#2980B9' },
    { name: 'Brown', hex: '#8B4513' }, { name: 'Golden', hex: '#DAA520' },
  ];
  kmRangeOptions = ['Under 20,000 km', '20,000 – 50,000 km', '50,000 – 80,000 km', 'Above 80,000 km'];
  readonly currentYear = new Date().getFullYear();
  // Include currentYear+1 so yearTo default is always visually selectable
  yearOptions = Array.from({ length: this.currentYear - 2004 + 1 }, (_, i) => 2005 + i);

  readonly isUsedCar = (c: any) => c.isSellerListing || c.km > 0 || c.year < 2024;

  makes = computed(() => {
    const usedCars = this.carsData.cars().filter(this.isUsedCar);
    return ['All', ...new Set(usedCars.map(c => c.make))].sort();
  });

  modelOptions = computed(() => {
    const make = this.heroMake();
    const usedCars = this.carsData.cars().filter(this.isUsedCar);
    const models = usedCars
      .filter(c => !make || make === 'All' || c.make === make)
      .map(c => c.model);
    return [...new Set(models)].sort();
  });

  usedCarCount = computed(() => this.carsData.cars().filter(this.isUsedCar).length);

  private avgUsedPrice = computed(() => {
    const used = this.carsData.cars().filter(this.isUsedCar);
    if (used.length === 0) return 500000;
    return used.reduce((sum, c) => sum + c.price, 0) / used.length;
  });

  private priceVerdict(price: number): PriceVerdict {
    const avg = this.avgUsedPrice();
    if (price < avg * 0.95) return 'fairDeal';
    if (price > avg * 1.05) return 'slightlyHigh';
    return 'goodPrice';
  }

  private formatKm(km: number): string {
    return km.toLocaleString('en-IN') + ' km';
  }

  private calcEmi(price: number): string {
    const principal = price * 0.9;
    const r = 0.085 / 12;
    const n = 60;
    const emi = (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    if (emi >= 100000) return `₹${(emi / 100000).toFixed(1)}L/mo`;
    return `₹${Math.round(emi / 100) * 100}/mo`;
  }

  private matchesKmRange(km: number, ranges: string[]): boolean {
    if (ranges.length === 0) return true;
    return ranges.some(r => {
      if (r === 'Under 20,000 km') return km < 20000;
      if (r === '20,000 – 50,000 km') return km >= 20000 && km <= 50000;
      if (r === '50,000 – 80,000 km') return km > 50000 && km <= 80000;
      if (r === 'Above 80,000 km') return km > 80000;
      return false;
    });
  }

  /** Effective city filter — empty when allIndiaOverride is true */
  effectiveCity = computed(() => this.allIndiaOverride() ? '' : this.heroCity());

  /** Count of used cars matching the current heroCity (before other filters) */
  cityCarsCount = computed(() => {
    const city = this.heroCity().toLowerCase();
    if (!city) return -1; // sentinel: no city filter
    const rawUsed = this.carsData.cars().filter(this.isUsedCar);
    return rawUsed.filter(c => (c.city ?? '').toLowerCase().includes(city)).length;
  });

  /** Show the soft "no cars in city, showing All India" banner */
  showAllIndiaBanner = computed(() =>
    this.allIndiaOverride() &&
    !!this.heroCity()
  );

  allFilteredCars = computed<UsedCarViewModel[]>(() => {
    const rawUsed = this.carsData.cars().filter(this.isUsedCar);
    const heroMake = this.heroMake();
    const heroModel = this.heroModel().toLowerCase();
    const heroCity = this.effectiveCity().toLowerCase();

    let filtered = rawUsed.filter(c => {
      if (heroMake && heroMake !== 'All' && c.make !== heroMake) return false;
      if (heroModel && !`${c.model} ${c.variant ?? ''}`.toLowerCase().includes(heroModel)) return false;
      if (heroCity && !(c.city ?? '').toLowerCase().includes(heroCity)) return false;
      const heroMax = this.heroBudgetMax();
      if (c.price < this.minBudget()) return false;
      if (heroMax > 0 && c.price > heroMax) return false;
      if (c.price > this.maxBudget()) return false;
      if (c.year < this.yearFrom() || c.year > this.yearTo()) return false;
      if (!this.matchesKmRange(c.km, this.selectedKmRanges())) return false;
      if (this.selectedFuels().length > 0 && !this.selectedFuels().includes(c.fuel)) return false;
      if (this.selectedTransmissions().length > 0 && !this.selectedTransmissions().some(t => c.transmission.includes(t))) return false;
      if (this.selectedBodyTypes().length > 0 && !this.selectedBodyTypes().includes(c.bodyType ?? '')) return false;
      if (this.selectedOwners().length > 0) {
        const ownerStr = c.owners ?? '';
        const matched = this.selectedOwners().some(o => {
          if (o === '1st Owner') return ownerStr.includes('1st') || ownerStr.includes('First');
          if (o === '2nd Owner') return ownerStr.includes('2nd') || ownerStr.includes('Second');
          if (o === '3rd Owner+') return ownerStr.includes('3rd') || ownerStr.includes('Third') || ownerStr.includes('4th');
          return false;
        });
        if (!matched) return false;
      }
      if (this.certifiedOnly() && !c.verified) return false;
      if (this.selectedColors().length > 0 && !this.selectedColors().some(col => (c.color ?? '').toLowerCase().includes(col.toLowerCase()))) return false;
      return true;
    });

    const sort = this.selectedSort();
    if (sort === 'Price: Low to High') filtered = [...filtered].sort((a, b) => a.price - b.price);
    else if (sort === 'Price: High to Low') filtered = [...filtered].sort((a, b) => b.price - a.price);
    else if (sort === 'Newest First') filtered = [...filtered].sort((a, b) => b.year - a.year);
    else if (sort === 'Lowest KM') filtered = [...filtered].sort((a, b) => a.km - b.km);
    else filtered = [...filtered].sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0));

    return filtered.map(c => ({
      ...c,
      priceVerdict: this.priceVerdict(c.price),
      formattedKm: this.formatKm(c.km),
      emiEstimate: this.calcEmi(c.price),
    }));
  });

  displayedCars = computed(() => this.allFilteredCars().slice(0, this.pageSize()));
  totalCount = computed(() => this.allFilteredCars().length);
  hasMore = computed(() => this.pageSize() < this.totalCount());

  activeFiltersCount = computed(() => {
    return this.selectedFuels().length + this.selectedTransmissions().length
      + this.selectedBodyTypes().length + this.selectedKmRanges().length
      + this.selectedOwners().length + this.selectedColors().length
      + (this.certifiedOnly() ? 1 : 0)
      + (this.minBudget() > 100000 ? 1 : 0)
      + (this.maxBudget() < 20000000 ? 1 : 0)
      + (this.heroMake() && this.heroMake() !== 'All' ? 1 : 0)
      + (this.heroModel() ? 1 : 0)
      + (this.effectiveCity() ? 1 : 0)  // chip only when city is actually filtering
      + (this.heroBudgetMax() > 0 ? 1 : 0)
      + (this.yearFrom() > 2005 ? 1 : 0)
      + (this.yearTo() < this.currentYear ? 1 : 0);
  });

  recentlyViewedCars = computed<Car[]>(() => {
    const ids = this.getRecentlyViewed();
    return ids.map(id => this.carsData.cars().find(c => String(c.id) === String(id))).filter((c): c is Car => !!c);
  });

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      try {
        const stored = localStorage.getItem('gaadiiq_wishlist');
        if (stored) this.wishlist.set(new Set(JSON.parse(stored)));
      } catch {}
    }

    // Snap navbar city to a canonical name, then check if any cars exist there
    const rawCity = this.cityService.selectedCity();
    if (rawCity) {
      const snapped = snapToPopularCity(rawCity);
      this.heroCity.set(snapped);
      // After data loads, check if 0 results → auto-switch to All India
      // We use a short defer so computed signals have settled
      setTimeout(() => {
        if (this.cityCarsCount() === 0) {
          this.allIndiaOverride.set(true);
        }
      }, 0);
    }

    this.route.queryParams.subscribe(params => {
      if (params['make']) this.heroMake.set(params['make']);
      if (params['model']) this.heroModel.set(params['model']);
      if (params['city']) {
        this.heroCity.set(snapToPopularCity(params['city']));
        this.allIndiaOverride.set(false);
      }
      if (params['fuel']) this.selectedFuels.set([params['fuel']]);
      if (params['bodyType']) this.selectedBodyTypes.set([params['bodyType']]);
      if (params['maxBudget']) {
        const v = +params['maxBudget'];
        this.heroBudgetMax.set(v);
        this.maxBudget.set(v);
      }
    });
  }

  /** Which budget thumb was last pressed — drives z-index so focused thumb is always on top */
  activeThumb = signal<'min' | 'max'>('max');

  onMinBudget(val: number) {
    this.minBudget.set(Math.min(val, this.maxBudget() - 100000));
  }

  onMaxBudget(val: number) {
    this.maxBudget.set(Math.max(val, this.minBudget() + 100000));
    if (this.heroBudgetMax() > 0) this.heroBudgetMax.set(0);
  }

  applyHeroSearch() {
    this.allIndiaOverride.set(false); // user explicitly searched — respect heroCity
    document.querySelector('.uc-main-layout')?.scrollIntoView({ behavior: 'smooth' });
  }

  onHeroCityChange(val: string) {
    this.heroCity.set(val);
    this.allIndiaOverride.set(false); // user is changing city — lift override
  }

  showAllIndia() {
    this.allIndiaOverride.set(true);
  }

  filterToCity() {
    this.allIndiaOverride.set(false);
  }

  // Infinite scroll sentinel (MOB-029)
  @ViewChild('scrollSentinel') scrollSentinel?: ElementRef<HTMLElement>;
  private _observer?: IntersectionObserver;

  ngAfterViewInit() {
    if (!isPlatformBrowser(this.platformId) || !this.scrollSentinel) return;
    this._observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && this.hasMore()) {
        this.loadMore();
      }
    }, { rootMargin: '200px' });
    this._observer.observe(this.scrollSentinel.nativeElement);
  }

  ngOnDestroy() {
    this._observer?.disconnect();
  }

  loadMore() {
    this.pageSize.update(n => n + 12);
  }

  toggleFuel(f: string) {
    const cur = this.selectedFuels();
    this.selectedFuels.set(cur.includes(f) ? cur.filter(x => x !== f) : [...cur, f]);
  }

  toggleTransmission(t: string) {
    const cur = this.selectedTransmissions();
    this.selectedTransmissions.set(cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t]);
  }

  toggleBodyType(bt: string) {
    const cur = this.selectedBodyTypes();
    this.selectedBodyTypes.set(cur.includes(bt) ? cur.filter(x => x !== bt) : [...cur, bt]);
  }

  toggleKmRange(r: string) {
    const cur = this.selectedKmRanges();
    this.selectedKmRanges.set(cur.includes(r) ? cur.filter(x => x !== r) : [...cur, r]);
  }

  toggleOwner(o: string) {
    const cur = this.selectedOwners();
    this.selectedOwners.set(cur.includes(o) ? cur.filter(x => x !== o) : [...cur, o]);
  }

  toggleColor(name: string) {
    const cur = this.selectedColors();
    this.selectedColors.set(cur.includes(name) ? cur.filter(x => x !== name) : [...cur, name]);
  }

  clearAllFilters() {
    this.heroMake.set('');
    this.heroModel.set('');
    this.heroCity.set('');
    this.heroBudgetMax.set(0);
    this.minBudget.set(100000);
    this.maxBudget.set(20000000);
    this.yearFrom.set(2005);
    this.yearTo.set(this.currentYear);
    this.selectedKmRanges.set([]);
    this.selectedFuels.set([]);
    this.selectedTransmissions.set([]);
    this.selectedBodyTypes.set([]);
    this.selectedOwners.set([]);
    this.certifiedOnly.set(false);
    this.selectedColors.set([]);
    this.pageSize.set(12);
    // Clear city from CityService so navbar city doesn't immediately re-filter
    this.cityService.clearCity();
    this.allIndiaOverride.set(false);
  }

  toggleWishlist(id: string) {
    const s = new Set(this.wishlist());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.wishlist.set(s);
    if (isPlatformBrowser(this.platformId)) {
      try { localStorage.setItem('gaadiiq_wishlist', JSON.stringify([...s])); } catch {}
    }
  }

  viewCar(id: string) {
    this.trackView(id);
    this.router.navigate(['/cars', id]);
  }

  private trackView(id: string) {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const stored = JSON.parse(localStorage.getItem('gaadiiq_recently_viewed') ?? '[]') as string[];
      const updated = [id, ...stored.filter(x => x !== id)].slice(0, 3);
      localStorage.setItem('gaadiiq_recently_viewed', JSON.stringify(updated));
    } catch {}
  }

  private getRecentlyViewed(): string[] {
    if (!isPlatformBrowser(this.platformId)) return [];
    try {
      return JSON.parse(localStorage.getItem('gaadiiq_recently_viewed') ?? '[]');
    } catch { return []; }
  }

  formatLakh(p: number) {
    if (p >= 10000000) return `₹${(p / 10000000).toFixed(1)} Cr`;
    if (p >= 100000) return `₹${(p / 100000).toFixed(1)}L`;
    return `₹${p.toLocaleString('en-IN')}`;
  }

  verdictLabel(v: PriceVerdict) {
    if (v === 'fairDeal') return '🟢 Fair Deal';
    if (v === 'slightlyHigh') return '🔴 Overpriced';
    return '🟡 Good Price';
  }

  verdictClass(v: PriceVerdict) {
    if (v === 'fairDeal') return 'verdict-fair';
    if (v === 'slightlyHigh') return 'verdict-high';
    return 'verdict-good';
  }
}
