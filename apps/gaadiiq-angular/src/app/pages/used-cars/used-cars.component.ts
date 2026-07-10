import { Component, signal, computed, OnInit, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { CarsDataService, Car } from '../../services/cars-data.service';
import { CityService } from '../../services/city.service';

type PriceVerdict = 'fairDeal' | 'goodPrice' | 'slightlyHigh';

interface UsedCarViewModel extends Car {
  priceVerdict: PriceVerdict;
  formattedKm: string;
  emiEstimate: string;
}

@Component({
  selector: 'app-used-cars',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './used-cars.component.html',
  styleUrl: './used-cars.component.scss'
})
export class UsedCarsComponent implements OnInit {
  protected readonly Math = Math;

  constructor(
    private carsData: CarsDataService,
    public cityService: CityService,
    private router: Router,
    @Inject(PLATFORM_ID) private platformId: object
  ) {}

  get loading() { return this.carsData.loading; }

  // Hero search fields
  heroMake = signal('');
  heroModel = signal('');
  heroBudgetMax = signal(5000000);
  heroCity = signal(''); // empty = All India (no city filter)

  cityOptions = ['Mumbai','Delhi','Bengaluru','Hyderabad','Chennai','Kolkata','Pune','Ahmedabad','Jaipur','Rourkela','Lucknow','Chandigarh','Surat','Nagpur','Indore'];

  // Sidebar filters
  sidebarOpen = signal(false);
  minBudget = signal(100000);
  maxBudget = signal(5000000);
  yearFrom = signal(2015);
  yearTo = signal(2025);
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
  wishlist = signal<Set<number>>(new Set());

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
  yearOptions = Array.from({ length: 11 }, (_, i) => 2015 + i);

  private isUsedCar = (c: any) => c.isSellerListing || c.km > 0 || c.year < 2025;

  makes = computed(() => {
    const usedCars = this.carsData.cars().filter(this.isUsedCar);
    return ['All', ...new Set(usedCars.map(c => c.make))].sort();
  });

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
    // 8.5% p.a., 60 months, 10% down payment
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

  allFilteredCars = computed<UsedCarViewModel[]>(() => {
    const rawUsed = this.carsData.cars().filter(this.isUsedCar);
    const heroMake = this.heroMake();
    const heroModel = this.heroModel().toLowerCase();
    const heroCity = this.heroCity().toLowerCase();

    let filtered = rawUsed.filter(c => {
      if (heroMake && heroMake !== 'All' && c.make !== heroMake) return false;
      if (heroModel && !`${c.model} ${c.variant ?? ''}`.toLowerCase().includes(heroModel)) return false;
      if (heroCity && !(c.city ?? '').toLowerCase().includes(heroCity)) return false;
      if (c.price < this.minBudget() || c.price > this.maxBudget()) return false;
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
      + (this.maxBudget() < 5000000 ? 1 : 0)
      + (this.yearFrom() > 2015 ? 1 : 0)
      + (this.yearTo() < 2025 ? 1 : 0);
  });

  recentlyViewedCars = computed<Car[]>(() => {
    const ids = this.getRecentlyViewed();
    return ids.map(id => this.carsData.cars().find(c => c.id === id)).filter((c): c is Car => !!c);
  });

  ngOnInit() {
    // Load wishlist from localStorage
    if (isPlatformBrowser(this.platformId)) {
      try {
        const stored = localStorage.getItem('gaadiiq_wishlist');
        if (stored) this.wishlist.set(new Set(JSON.parse(stored)));
      } catch {}
    }
  }

  onMinBudget(val: number) {
    this.minBudget.set(Math.min(val, this.maxBudget() - 100000));
  }

  onMaxBudget(val: number) {
    this.maxBudget.set(Math.max(val, this.minBudget() + 100000));
  }

  applyHeroSearch() {
    // Filters are already reactive — just scroll to results
    document.querySelector('.uc-main-layout')?.scrollIntoView({ behavior: 'smooth' });
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
    this.minBudget.set(100000);
    this.maxBudget.set(5000000);
    this.yearFrom.set(2015);
    this.yearTo.set(2025);
    this.selectedKmRanges.set([]);
    this.selectedFuels.set([]);
    this.selectedTransmissions.set([]);
    this.selectedBodyTypes.set([]);
    this.selectedOwners.set([]);
    this.certifiedOnly.set(false);
    this.selectedColors.set([]);
    this.pageSize.set(12);
  }

  toggleWishlist(id: number) {
    const s = new Set(this.wishlist());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.wishlist.set(s);
    if (isPlatformBrowser(this.platformId)) {
      try { localStorage.setItem('gaadiiq_wishlist', JSON.stringify([...s])); } catch {}
    }
  }

  viewCar(id: number) {
    this.trackView(id);
    this.router.navigate(['/cars', id]);
  }

  private trackView(id: number) {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const stored = JSON.parse(localStorage.getItem('gaadiiq_recently_viewed') ?? '[]') as number[];
      const updated = [id, ...stored.filter(x => x !== id)].slice(0, 3);
      localStorage.setItem('gaadiiq_recently_viewed', JSON.stringify(updated));
    } catch {}
  }

  private getRecentlyViewed(): number[] {
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
