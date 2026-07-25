import { Component, signal, computed, OnInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import { CarsDataService } from '../../services/cars-data.service';
import { BrandsService } from '../../services/brands.service';
import { AuthService } from '../../services/auth.service';

const PLACEHOLDER = 'assets/cars/placeholder.svg';
const COMPARE_KEY = 'gaadiiq_compare_keys';
const NOTIFY_KEY = 'gaadiiq_upcoming_notify';
const LUXURY_MIN = 3000000;

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

interface BudgetRange {
  label: string;
  min: number;
  max: number | null; // null = no upper bound
}

@Component({
  selector: 'app-new-cars',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './new-cars.component.html',
  styleUrl: './new-cars.component.scss'
})
export class NewCarsComponent implements OnInit {
  @ViewChild('modelsSection') modelsSection?: ElementRef<HTMLElement>;

  readonly placeholder = PLACEHOLDER;

  constructor(
    private carsData: CarsDataService,
    private router: Router,
    private route: ActivatedRoute,
    public brandsService: BrandsService,
    private auth: AuthService,
  ) {}

  get loading() { return this.carsData.loading; }

  activeHeroTab = signal<'brand' | 'budget' | 'bodytype'>('brand');
  sidebarOpen = signal(false);
  compareSet = signal<Set<string>>(new Set());
  notifyMsg = signal('');

  // Filters for Popular Models (support min + max budget)
  selectedBodyTypes = signal<string[]>([]);
  selectedFuels = signal<string[]>([]);
  selectedTransmissions = signal<string[]>([]);
  minBudget = signal(0);
  maxBudget = signal(10000000);
  selectedSort = signal('Popularity');

  bodyTypeOptions = ['Hatchback', 'Sedan', 'SUV', 'MUV', 'Electric', 'Luxury'];
  fuelOptions = ['Petrol', 'Diesel', 'Electric', 'CNG', 'Hybrid'];
  transmissionOptions = ['Manual', 'Automatic', 'CVT', 'DCT', 'AMT'];
  sortOptions = ['Popularity', 'Price: Low to High', 'Price: High to Low'];

  get brands() { return this.brandsService.brands(); }

  bodyTypeCards = [
    { name: 'Hatchback', icon: '🚗', desc: 'Compact & city-friendly' },
    { name: 'Sedan', icon: '🚘', desc: 'Comfortable & stylish' },
    { name: 'SUV', icon: '🚙', desc: 'Powerful & versatile' },
    { name: 'MUV', icon: '🚐', desc: 'Space for the family' },
    { name: 'Electric', icon: '⚡', desc: 'Future-ready EVs' },
    { name: 'Luxury', icon: '✨', desc: 'Premium experience' },
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

  newCarModels = computed<NewCarModel[]>(() => {
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
      const rep = inBand.find(c => c.image && !c.image.includes('aeplcdn')) ?? inBand.find(c => c.image) ?? inBand[0];
      const fuels = [...new Set(inBand.map(c => c.fuel))];
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
      if (selTxs.length > 0 && !inBand.some(c => selTxs.some(t => c.transmission.includes(t)))) return;

      const image = this.resolveImage(make, model, rep.image);

      models.push({
        make, model,
        image,
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        variantCount: inBand.length,
        bodyType,
        fuels,
        rating: rep.rating,
        reviews: rep.reviews,
        badge: rep.badge,
        representativeId: rep.id,
      });
    });

    const sort = this.selectedSort();
    if (sort === 'Price: Low to High') return models.sort((a, b) => a.minPrice - b.minPrice);
    if (sort === 'Price: High to Low') return models.sort((a, b) => b.minPrice - a.minPrice);
    return models.sort((a, b) => b.reviews - a.reviews);
  });

  activeFiltersCount = computed(() => {
    return this.selectedBodyTypes().length
      + this.selectedFuels().length
      + this.selectedTransmissions().length
      + (this.minBudget() > 0 ? 1 : 0)
      + (this.maxBudget() < 10000000 ? 1 : 0);
  });

  budgetFilterLabel = computed(() => {
    const min = this.minBudget();
    const max = this.maxBudget();
    if (min > 0 && max >= 10000000) return `Above ${this.formatBudgetLabel(min)}`;
    if (min > 0 && max < 10000000) return `${this.formatBudgetLabel(min)} – ${this.formatBudgetLabel(max)}`;
    if (max < 10000000) return `Max ${this.formatBudgetLabel(max)}`;
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
      if (params['make'] || params['minPrice'] || params['maxPrice'] || params['bodyType']) {
        setTimeout(() => this.scrollToModels(), 100);
      }
    });
  }

  private resolveImage(make: string, model: string, raw?: string): string {
    const key = `${make} ${model}`;
    if (key === 'Maruti Suzuki Swift' || model === 'Swift') return 'assets/cars/maruti-swift/front.svg';
    if (raw && !raw.includes('aeplcdn') && raw.trim()) return raw;
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
    if (this.maxBudget() < 10000000) qp['maxPrice'] = this.maxBudget();
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
    this.maxBudget.set(10000000);
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
    this.maxBudget.set(10000000);
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
