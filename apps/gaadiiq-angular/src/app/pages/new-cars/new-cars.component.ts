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
    { name: 'Tata',          logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Tata_logo_2020.svg/120px-Tata_logo_2020.svg.png' },
    { name: 'Maruti Suzuki', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Suzuki_logo_2.svg/120px-Suzuki_logo_2.svg.png' },
    { name: 'Mahindra',      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Mahindra_%26_Mahindra_Logo.svg/120px-Mahindra_%26_Mahindra_Logo.svg.png' },
    { name: 'Nissan',        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Nissan_-_logo_%28English%29.svg/120px-Nissan_-_logo_%28English%29.svg.png' },
    { name: 'Hyundai',       logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Hyundai_Motor_Company_logo.svg/120px-Hyundai_Motor_Company_logo.svg.png' },
    { name: 'Toyota',        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Toyota_carlogo.svg/120px-Toyota_carlogo.svg.png' },
    { name: 'Kia',           logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/Kia-logo.svg/120px-Kia-logo.svg.png' },
    { name: 'BMW',           logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/BMW.svg/120px-BMW.svg.png' },
    { name: 'Skoda',         logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Skoda_Auto_logo.svg/120px-Skoda_Auto_logo.svg.png' },
    { name: 'MG',            logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/MG_Motor_logo.svg/120px-MG_Motor_logo.svg.png' },
    { name: 'Renault',       logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/Renault_2021_Text.svg/120px-Renault_2021_Text.svg.png' },
    { name: 'Volkswagen',    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Volkswagen_logo_2019.svg/120px-Volkswagen_logo_2019.svg.png' },
    { name: 'Mercedes-Benz', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Mercedes-Logo.svg/120px-Mercedes-Logo.svg.png' },
    { name: 'Honda',         logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/76/Honda_logo.svg/120px-Honda_logo.svg.png' },
    { name: 'Land Rover',    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Land_Rover_logo.svg/120px-Land_Rover_logo.svg.png' },
    { name: 'Citroen',       logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Logo_citroen.svg/120px-Logo_citroen.svg.png' },
    { name: 'VinFast',       logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/VinFast_logo.svg/120px-VinFast_logo.svg.png' },
    { name: 'BYD',           logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/BYD_Auto_logo.svg/120px-BYD_Auto_logo.svg.png' },
    { name: 'Jeep',          logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/Jeep_logo.svg/120px-Jeep_logo.svg.png' },
    { name: 'Audi',          logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/Audi-Logo_2016.svg/120px-Audi-Logo_2016.svg.png' },
    { name: 'Porsche',       logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Porsche_logo.svg/120px-Porsche_logo.svg.png' },
    { name: 'Volvo',         logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Volvo_cars_logo.svg/120px-Volvo_cars_logo.svg.png' },
    { name: 'Lexus',         logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Lexus_logo.svg/120px-Lexus_logo.svg.png' },
    { name: 'Mini',          logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/MINI_logo.svg/120px-MINI_logo.svg.png' },
    { name: 'Force Motors',  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Force_Motors_logo.svg/120px-Force_Motors_logo.svg.png' },
    { name: 'Lamborghini',   logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Lamborghini_Logo.svg/120px-Lamborghini_Logo.svg.png' },
    { name: 'Jaguar',        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Jaguar_logo.svg/120px-Jaguar_logo.svg.png' },
    { name: 'Rolls-Royce',   logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Rolls-Royce_Motor_Cars_logo.svg/120px-Rolls-Royce_Motor_Cars_logo.svg.png' },
    { name: 'Ferrari',       logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Ferrari-Logo.svg/120px-Ferrari-Logo.svg.png' },
    { name: 'Tesla',         logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/Tesla_T_symbol.svg/120px-Tesla_T_symbol.svg.png' },
    { name: 'Isuzu',         logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Isuzu_wordmark.svg/120px-Isuzu_wordmark.svg.png' },
    { name: 'Maserati',      logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Maserati_badge.svg/120px-Maserati_badge.svg.png' },
    { name: 'Aston Martin',  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Aston_Martin_logo.svg/120px-Aston_Martin_logo.svg.png' },
    { name: 'McLaren',       logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/McLaren_logo_%282020%29.svg/120px-McLaren_logo_%282020%29.svg.png' },
    { name: 'Bentley',       logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/Bentley_logo.svg/120px-Bentley_logo.svg.png' },
    { name: 'Lotus',         logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/Lotus_cars_logo.svg/120px-Lotus_cars_logo.svg.png' },
    { name: 'OLA Electric',  logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Ola_Electric_logo.svg/120px-Ola_Electric_logo.svg.png' },
    { name: 'Genesis',       logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Genesis_Motor_logo.svg/120px-Genesis_Motor_logo.svg.png' },
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
