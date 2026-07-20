import { Component, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { CarsDataService } from '../../services/cars-data.service';
import { IconComponent } from '../../components/icon/icon.component';
import { BrandsService } from '../../services/brands.service';

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
  representativeId: number;
}

interface NewLaunch {
  make: string;
  model: string;
  price: string;
  launchDate: string;
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

@Component({
  selector: 'app-new-cars',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IconComponent],
  templateUrl: './new-cars.component.html',
  styleUrl: './new-cars.component.scss'
})
export class NewCarsComponent implements OnInit {
  constructor(
    private carsData: CarsDataService,
    public router: Router,
    public brandsService: BrandsService
  ) {}

  get loading() { return this.carsData.loading; }

  activeHeroTab = signal<'brand' | 'budget' | 'bodytype'>('brand');
  sidebarOpen = signal(false);
  compareSet = signal<Set<string>>(new Set());

  // Filters
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
    { name: 'Hatchback', icon: 'car', desc: 'Compact & city-friendly' },
    { name: 'Sedan', icon: 'car', desc: 'Comfortable & stylish' },
    { name: 'SUV', icon: 'trending-up', desc: 'Powerful & versatile' },
    { name: 'MUV', icon: 'user', desc: 'Space for the family' },
    { name: 'Electric', icon: 'zap', desc: 'Future-ready EVs' },
    { name: 'Luxury', icon: 'star', desc: 'Premium experience' },
  ];

  budgetRanges = [
    { label: 'Under ₹5L',  min: 0,       max: 500000    },
    { label: '₹5 – 10L',   min: 500000,  max: 1000000   },
    { label: '₹10 – 15L',  min: 1000000, max: 1500000   },
    { label: '₹15 – 20L',  min: 1500000, max: 2000000   },
    { label: '₹20 – 30L',  min: 2000000, max: 3000000   },
    { label: 'Above ₹30L', min: 3000000, max: 100000000 },
  ];

  newLaunches: NewLaunch[] = [
    { make: 'Tata', model: 'Curvv', price: '₹9.99L onwards', launchDate: 'Oct 2024', bodyType: 'SUV', fuel: 'Petrol / Diesel', image: 'assets/cars/placeholder.svg', isNew: true },
    { make: 'Mahindra', model: 'BE 6', price: '₹18.90L onwards', launchDate: 'Feb 2025', bodyType: 'SUV', fuel: 'Electric', image: 'assets/cars/placeholder.svg', isNew: true },
    { make: 'Hyundai', model: 'Creta EV', price: '₹17.99L onwards', launchDate: 'Jan 2025', bodyType: 'SUV', fuel: 'Electric', image: 'assets/cars/placeholder.svg', isNew: true },
    { make: 'Skoda', model: 'Kylaq', price: '₹7.89L onwards', launchDate: 'Dec 2024', bodyType: 'SUV', fuel: 'Petrol', image: 'assets/cars/placeholder.svg', isNew: true },
    { make: 'Maruti Suzuki', model: 'Swift 2024', price: '₹6.49L onwards', launchDate: 'May 2024', bodyType: 'Hatchback', fuel: 'Petrol / CNG', image: 'assets/cars/swift/front.jpg', isNew: false },
    { make: 'Kia', model: 'Syros', price: '₹8.99L onwards', launchDate: 'Jan 2025', bodyType: 'SUV', fuel: 'Petrol / Diesel', image: 'assets/cars/placeholder.svg', isNew: true },
  ];

  upcomingCars: UpcomingCar[] = [
    { make: 'Tata', model: 'Sierra EV', expectedPrice: '₹25 – 30L', expectedDate: 'Q3 2026', bodyType: 'SUV', fuel: 'Electric', image: 'assets/cars/placeholder.svg' },
    { make: 'Mahindra', model: 'XEV 7e', expectedPrice: '₹30 – 40L', expectedDate: 'Q4 2026', bodyType: 'SUV', fuel: 'Electric', image: 'assets/cars/placeholder.svg' },
    { make: 'Toyota', model: 'Urban Cruiser', expectedPrice: '₹12 – 18L', expectedDate: 'Q2 2026', bodyType: 'SUV', fuel: 'Hybrid', image: 'assets/cars/placeholder.svg' },
    { make: 'Honda', model: 'Elevate Sport', expectedPrice: '₹16 – 22L', expectedDate: 'Q3 2026', bodyType: 'SUV', fuel: 'Petrol', image: 'assets/cars/placeholder.svg' },
    { make: 'MG', model: 'Windsor EV Pro', expectedPrice: '₹22 – 28L', expectedDate: 'Q1 2027', bodyType: 'SUV', fuel: 'Electric', image: 'assets/cars/placeholder.svg' },
  ];

  expertPicks = [
    { category: 'Best Value', icon: 'bar-chart', make: 'Maruti Suzuki', model: 'Fronx', price: '₹7.51L', reason: 'Stellar mileage, feature-rich at this price point', badge: 'Value Pick' },
    { category: 'Best EV', icon: 'zap', make: 'Tata', model: 'Nexon EV', price: '₹14.49L', reason: 'Longest real-world range, excellent after-sales', badge: 'EV Leader' },
    { category: 'Best Family Car', icon: 'user', make: 'Kia', model: 'Carens', price: '₹10.49L', reason: '6/7-seater, top safety scores, premium interiors', badge: 'Family Fav' },
  ];

  notifiedCars = signal<Set<string>>(
    new Set<string>(JSON.parse(localStorage.getItem('gaadiiq_notified_cars') ?? '[]'))
  );

  newCarModels = computed<NewCarModel[]>(() => {
    const newCars = this.carsData.cars().filter(c => c.km === 0 && c.year >= 2025);
    const map = new Map<string, typeof newCars>();
    for (const c of newCars) {
      const key = `${c.make}||${c.model}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }

    const selBTs = this.selectedBodyTypes();
    const selFuels = this.selectedFuels();
    const selTxs = this.selectedTransmissions();
    const budget = this.maxBudget();

    const models: NewCarModel[] = [];
    map.forEach((cars, key) => {
      const [make, model] = key.split('||');
      const minB = this.minBudget();
      const affordable = cars.filter(c => c.price <= budget && c.price >= minB);
      if (affordable.length === 0) return;
      const prices = affordable.map(c => c.price);
      const rep = affordable.find(c => c.image) ?? affordable[0];
      const fuels = [...new Set(affordable.map(c => c.fuel))];
      const bodyType = rep.bodyType ?? '';

      if (selBTs.length > 0 && !selBTs.includes(bodyType)) return;
      if (selFuels.length > 0 && !fuels.some(f => selFuels.includes(f))) return;
      if (selTxs.length > 0 && !affordable.some(c => selTxs.some(t => c.transmission.includes(t)))) return;

      models.push({
        make, model,
        image: rep.image,
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        variantCount: affordable.length,
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
    return this.selectedBodyTypes().length + this.selectedFuels().length + this.selectedTransmissions().length
      + (this.maxBudget() < 10000000 || this.minBudget() > 0 ? 1 : 0);
  });

  ngOnInit() {}

  toggleBodyType(bt: string) {
    const current = this.selectedBodyTypes();
    this.selectedBodyTypes.set(
      current.includes(bt) ? current.filter(x => x !== bt) : [...current, bt]
    );
  }

  toggleFuel(f: string) {
    const current = this.selectedFuels();
    this.selectedFuels.set(
      current.includes(f) ? current.filter(x => x !== f) : [...current, f]
    );
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
  }

  activeBudgetLabel = computed(() => {
    const min = this.minBudget();
    const max = this.maxBudget();
    if (min > 0 && max >= 10000000) return `Above ${this.formatLakh(min)}`;
    if (min > 0) return `${this.formatLakh(min)} – ${this.formatLakh(max)}`;
    if (max < 10000000) return `Under ${this.formatLakh(max)}`;
    return null;
  });

  toggleCompare(key: string) {
    const s = new Set(this.compareSet());
    if (s.has(key)) s.delete(key); else s.add(key);
    this.compareSet.set(s);
    sessionStorage.setItem('gaadiiq_compare_keys', JSON.stringify([...s]));
  }

  toggleNotify(key: string) {
    const s = new Set(this.notifiedCars());
    if (s.has(key)) s.delete(key); else s.add(key);
    this.notifiedCars.set(s);
    localStorage.setItem('gaadiiq_notified_cars', JSON.stringify([...s]));
  }

  navigateToBrand(brand: string) {
    this.router.navigate(['/listings'], { queryParams: { carType: 'New', make: brand } });
  }

  navigateToBodyType(bodyType: string) {
    if (bodyType === 'Electric') {
      this.toggleFuel('Electric');
    } else if (bodyType === 'Luxury') {
      this.minBudget.set(3000000);
      this.maxBudget.set(10000000);
    } else {
      this.toggleBodyType(bodyType);
    }
    this.scrollToModels();
  }

  navigateToBudget(min: number, max: number) {
    this.minBudget.set(min);
    this.maxBudget.set(max);
    this.scrollToModels();
  }

  scrollToModels() {
    setTimeout(() => {
      document.getElementById('popular-models')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  formatLakh(p: number) {
    if (p >= 10000000) return `₹${(p / 10000000).toFixed(1)} Cr`;
    return `₹${(p / 100000).toFixed(1)}L`;
  }

  formatBudgetLabel(val: number) {
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(0)} Cr`;
    return `₹${(val / 100000).toFixed(0)}L`;
  }

  stars(rating: number) {
    return Math.round(rating);
  }
}
