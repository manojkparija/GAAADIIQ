import { Component, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { CarsDataService } from '../../services/cars-data.service';

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
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './new-cars.component.html',
  styleUrl: './new-cars.component.scss'
})
export class NewCarsComponent implements OnInit {
  constructor(private carsData: CarsDataService, private router: Router) {}

  get loading() { return this.carsData.loading; }

  activeHeroTab = signal<'brand' | 'budget' | 'bodytype'>('brand');
  sidebarOpen = signal(false);
  compareSet = signal<Set<string>>(new Set());

  // Filters
  selectedBodyTypes = signal<string[]>([]);
  selectedFuels = signal<string[]>([]);
  selectedTransmissions = signal<string[]>([]);
  maxBudget = signal(10000000);
  selectedSort = signal('Popularity');

  bodyTypeOptions = ['Hatchback', 'Sedan', 'SUV', 'MUV', 'Electric', 'Luxury'];
  fuelOptions = ['Petrol', 'Diesel', 'Electric', 'CNG', 'Hybrid'];
  transmissionOptions = ['Manual', 'Automatic', 'CVT', 'DCT', 'AMT'];
  sortOptions = ['Popularity', 'Price: Low to High', 'Price: High to Low'];

  brands = [
    { name: 'Tata',          logo: 'https://logo.clearbit.com/tata.com' },
    { name: 'Maruti Suzuki', logo: 'https://logo.clearbit.com/marutisuzuki.com' },
    { name: 'Mahindra',      logo: 'https://logo.clearbit.com/mahindra.com' },
    { name: 'Nissan',        logo: 'https://logo.clearbit.com/nissan.com' },
    { name: 'Hyundai',       logo: 'https://logo.clearbit.com/hyundai.com' },
    { name: 'Toyota',        logo: 'https://logo.clearbit.com/toyota.com' },
    { name: 'Kia',           logo: 'https://logo.clearbit.com/kia.com' },
    { name: 'BMW',           logo: 'https://logo.clearbit.com/bmw.com' },
    { name: 'Skoda',         logo: 'https://logo.clearbit.com/skoda-auto.com' },
    { name: 'MG',            logo: 'https://logo.clearbit.com/mgmotor.co.in' },
    { name: 'Renault',       logo: 'https://logo.clearbit.com/renault.com' },
    { name: 'Volkswagen',    logo: 'https://logo.clearbit.com/volkswagen.com' },
    { name: 'Mercedes-Benz', logo: 'https://logo.clearbit.com/mercedes-benz.com' },
    { name: 'Honda',         logo: 'https://logo.clearbit.com/honda.com' },
    { name: 'Land Rover',    logo: 'https://logo.clearbit.com/landrover.com' },
    { name: 'Citroen',       logo: 'https://logo.clearbit.com/citroen.com' },
    { name: 'VinFast',       logo: 'https://logo.clearbit.com/vinfastauto.com' },
    { name: 'BYD',           logo: 'https://logo.clearbit.com/byd.com' },
    { name: 'Jeep',          logo: 'https://logo.clearbit.com/jeep.com' },
    { name: 'Audi',          logo: 'https://logo.clearbit.com/audi.com' },
    { name: 'Porsche',       logo: 'https://logo.clearbit.com/porsche.com' },
    { name: 'Volvo',         logo: 'https://logo.clearbit.com/volvocars.com' },
    { name: 'Lexus',         logo: 'https://logo.clearbit.com/lexus.com' },
    { name: 'Mini',          logo: 'https://logo.clearbit.com/mini.com' },
    { name: 'Force Motors',  logo: 'https://logo.clearbit.com/forcemotors.com' },
    { name: 'Lamborghini',   logo: 'https://logo.clearbit.com/lamborghini.com' },
    { name: 'Jaguar',        logo: 'https://logo.clearbit.com/jaguar.com' },
    { name: 'Rolls-Royce',   logo: 'https://logo.clearbit.com/rolls-roycemotorcars.com' },
    { name: 'Ferrari',       logo: 'https://logo.clearbit.com/ferrari.com' },
    { name: 'Tesla',         logo: 'https://logo.clearbit.com/tesla.com' },
    { name: 'Isuzu',         logo: 'https://logo.clearbit.com/isuzu.com' },
    { name: 'Maserati',      logo: 'https://logo.clearbit.com/maserati.com' },
    { name: 'Aston Martin',  logo: 'https://logo.clearbit.com/astonmartin.com' },
    { name: 'McLaren',       logo: 'https://logo.clearbit.com/mclaren.com' },
    { name: 'Bentley',       logo: 'https://logo.clearbit.com/bentleymotors.com' },
    { name: 'Lotus',         logo: 'https://logo.clearbit.com/lotuscars.com' },
    { name: 'OLA Electric',  logo: 'https://logo.clearbit.com/olaelectric.com' },
    { name: 'Genesis',       logo: 'https://logo.clearbit.com/genesis.com' },
  ];

  bodyTypeCards = [
    { name: 'Hatchback', icon: '🚗', desc: 'Compact & city-friendly' },
    { name: 'Sedan', icon: '🚙', desc: 'Comfortable & stylish' },
    { name: 'SUV', icon: '🏔️', desc: 'Powerful & versatile' },
    { name: 'MUV', icon: '👨‍👩‍👧', desc: 'Space for the family' },
    { name: 'Electric', icon: '⚡', desc: 'Future-ready EVs' },
    { name: 'Luxury', icon: '💎', desc: 'Premium experience' },
  ];

  budgetRanges = [
    { label: 'Under ₹5L', max: 500000 },
    { label: '₹5 – 10L', max: 1000000 },
    { label: '₹10 – 15L', max: 1500000 },
    { label: '₹15 – 20L', max: 2000000 },
    { label: '₹20 – 30L', max: 3000000 },
    { label: 'Above ₹30L', max: 100000000 },
  ];

  newLaunches: NewLaunch[] = [
    { make: 'Tata', model: 'Curvv', price: '₹9.99L onwards', launchDate: 'Oct 2024', bodyType: 'SUV', fuel: 'Petrol / Diesel', image: 'https://imgd.aeplcdn.com/1200x900/n/cw/ec/230805/curvv-exterior-right-front-three-quarter-2.jpeg', isNew: true },
    { make: 'Mahindra', model: 'BE 6', price: '₹18.90L onwards', launchDate: 'Feb 2025', bodyType: 'SUV', fuel: 'Electric', image: 'https://imgd.aeplcdn.com/1200x900/n/cw/ec/239729/be-6e-exterior-right-front-three-quarter.jpeg', isNew: true },
    { make: 'Hyundai', model: 'Creta EV', price: '₹17.99L onwards', launchDate: 'Jan 2025', bodyType: 'SUV', fuel: 'Electric', image: 'https://imgd.aeplcdn.com/1200x900/n/cw/ec/230921/creta-electric-exterior-right-front-three-quarter-3.jpeg', isNew: true },
    { make: 'Skoda', model: 'Kylaq', price: '₹7.89L onwards', launchDate: 'Dec 2024', bodyType: 'SUV', fuel: 'Petrol', image: 'https://imgd.aeplcdn.com/1200x900/n/cw/ec/230961/kylaq-exterior-right-front-three-quarter-3.jpeg', isNew: true },
    { make: 'Maruti Suzuki', model: 'Swift 2024', price: '₹6.49L onwards', launchDate: 'May 2024', bodyType: 'Hatchback', fuel: 'Petrol / CNG', image: 'assets/cars/swift/front.jpg', isNew: false },
    { make: 'Kia', model: 'Syros', price: '₹8.99L onwards', launchDate: 'Jan 2025', bodyType: 'SUV', fuel: 'Petrol / Diesel', image: 'https://imgd.aeplcdn.com/1200x900/n/cw/ec/240729/syros-exterior-right-front-three-quarter.jpeg', isNew: true },
  ];

  upcomingCars: UpcomingCar[] = [
    { make: 'Tata', model: 'Sierra EV', expectedPrice: '₹25 – 30L', expectedDate: 'Q3 2026', bodyType: 'SUV', fuel: 'Electric', image: 'https://imgd.aeplcdn.com/1200x900/n/cw/ec/166657/nexon-ev-exterior-right-front-three-quarter.jpeg' },
    { make: 'Mahindra', model: 'XEV 7e', expectedPrice: '₹30 – 40L', expectedDate: 'Q4 2026', bodyType: 'SUV', fuel: 'Electric', image: 'https://imgd.aeplcdn.com/1200x900/n/cw/ec/239729/be-6e-exterior-right-front-three-quarter.jpeg' },
    { make: 'Toyota', model: 'Urban Cruiser', expectedPrice: '₹12 – 18L', expectedDate: 'Q2 2026', bodyType: 'SUV', fuel: 'Hybrid', image: 'https://imgd.aeplcdn.com/1200x900/n/cw/ec/55316/fortuner-exterior-right-front-three-quarter-2.jpeg' },
    { make: 'Honda', model: 'Elevate Sport', expectedPrice: '₹16 – 22L', expectedDate: 'Q3 2026', bodyType: 'SUV', fuel: 'Petrol', image: 'https://imgd.aeplcdn.com/1200x900/n/cw/ec/166657/nexon-ev-exterior-right-front-three-quarter.jpeg' },
    { make: 'MG', model: 'Windsor EV Pro', expectedPrice: '₹22 – 28L', expectedDate: 'Q1 2027', bodyType: 'SUV', fuel: 'Electric', image: 'https://imgd.aeplcdn.com/1200x900/n/cw/ec/199321/nexon-exterior-right-front-three-quarter-2.jpeg' },
  ];

  expertPicks = [
    { category: 'Best Value', icon: '💰', make: 'Maruti Suzuki', model: 'Fronx', price: '₹7.51L', reason: 'Stellar mileage, feature-rich at this price point', badge: 'Value Pick' },
    { category: 'Best EV', icon: '⚡', make: 'Tata', model: 'Nexon EV', price: '₹14.49L', reason: 'Longest real-world range, excellent after-sales', badge: 'EV Leader' },
    { category: 'Best Family Car', icon: '👨‍👩‍👧', make: 'Kia', model: 'Carens', price: '₹10.49L', reason: '6/7-seater, top safety scores, premium interiors', badge: 'Family Fav' },
  ];

  notifiedCars = signal<Set<string>>(new Set());

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
      const affordable = cars.filter(c => c.price <= budget);
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
      + (this.maxBudget() < 10000000 ? 1 : 0);
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
    this.maxBudget.set(10000000);
    this.selectedSort.set('Popularity');
  }

  toggleCompare(key: string) {
    const s = new Set(this.compareSet());
    if (s.has(key)) s.delete(key); else s.add(key);
    this.compareSet.set(s);
  }

  toggleNotify(key: string) {
    const s = new Set(this.notifiedCars());
    if (s.has(key)) s.delete(key); else s.add(key);
    this.notifiedCars.set(s);
  }

  navigateToBrand(brand: string) {
    this.router.navigate(['/listings'], { queryParams: { carType: 'New', make: brand } });
  }

  navigateToBodyType(bodyType: string) {
    this.router.navigate(['/listings'], { queryParams: { carType: 'New', bodyType } });
  }

  navigateToBudget(max: number) {
    this.router.navigate(['/listings'], { queryParams: { carType: 'New', maxPrice: max } });
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
