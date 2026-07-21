import { Component, signal, computed, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { CarCardComponent } from '../../components/car-card/car-card.component';
import { CarsDataService, Car } from '../../services/cars-data.service';

interface NewCarModel {
  make: string; model: string; image: string;
  minPrice: number; maxPrice: number;
  variantCount: number; bodyType: string; fuel: string;
  rating: number; reviews: number; badge: string;
  representativeId: number;
}

@Component({
  selector: 'app-listings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CarCardComponent],
  templateUrl: './listings.component.html',
  styleUrl: './listings.component.scss'
})
export class ListingsComponent implements OnInit {
  constructor(private route: ActivatedRoute, private carsData: CarsDataService, private router: Router) {}

  get loading() { return this.carsData.loading; }

  searchQuery        = signal('');
  selectedFuel       = signal('All');
  selectedTransmission = signal('All');
  selectedBodyType   = signal('All');
  selectedSort       = signal('Relevance');
  selectedMake       = signal('All');
  selectedModelName  = signal('All');
  minPrice           = signal(0);
  maxPrice           = signal(20000000);
  minYear            = signal(2018);
  sidebarOpen        = signal(false);

  // Top-level car type: 'All' | 'New' | 'Used'
  carType = signal<'All' | 'New' | 'Used'>('All');

  // Used-only sub-filter: 'All' | '< 50k km' | '> 50k km'
  usedKmRange = signal<'All' | '< 50k km' | '> 50k km'>('All');

  private readonly LUXURY_MIN = 3000000;

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      if (params['q']) this.searchQuery.set(params['q']);
      this.selectedMake.set(params['make'] || 'All');
      this.selectedModelName.set(params['model'] || 'All');

      // Body type special cases: Electric → fuel, Luxury → min price
      const bt = params['bodyType'] || 'All';
      if (bt === 'Electric') {
        this.selectedBodyType.set('All');
        this.selectedFuel.set(params['fuel'] || 'Electric');
      } else if (bt === 'Luxury') {
        this.selectedBodyType.set('All');
        this.minPrice.set(Math.max(+params['minPrice'] || 0, this.LUXURY_MIN));
        this.selectedFuel.set(params['fuel'] || 'All');
      } else {
        this.selectedBodyType.set(bt);
        this.selectedFuel.set(params['fuel'] || 'All');
      }

      if (params['carType']) this.carType.set(params['carType'] as any);
      if (params['minPrice'] != null && params['minPrice'] !== '' && bt !== 'Luxury') {
        this.minPrice.set(+params['minPrice']);
      } else if (!params['minPrice'] && bt !== 'Luxury') {
        this.minPrice.set(0);
      }
      if (params['maxPrice'] != null && params['maxPrice'] !== '') {
        this.maxPrice.set(+params['maxPrice']);
      } else if (!params['maxPrice']) {
        this.maxPrice.set(20000000);
      }
      if (params['transmission']) this.selectedTransmission.set(params['transmission']);

      // Deep-link to a specific model’s variants
      if (params['make'] && params['model']) {
        this.carType.set('New');
        this.selectedModel.set(`${params['make']}||${params['model']}`);
      } else if (!params['model']) {
        this.selectedModel.set(null);
      }
    });
  }

  fuels         = ['All', 'Petrol', 'Diesel', 'Electric', 'CNG', 'Hybrid'];
  transmissions = ['All', 'Manual', 'Automatic', 'CVT', 'DCT', 'AMT'];
  bodyTypes     = ['All', 'Hatchback', 'Sedan', 'SUV', 'MUV'];
  sorts         = ['Relevance', 'Price: Low to High', 'Price: High to Low', 'Newest First', 'Top Rated'];

  setCarType(t: 'All' | 'New' | 'Used') {
    this.carType.set(t);
    this.usedKmRange.set('All');
  }

  filteredCars = computed(() => {
    let cars = this.carsData.cars().filter(c => {
      const q = this.searchQuery().toLowerCase();
      const matchQ  = !q || `${c.make} ${c.model} ${c.variant ?? ''} ${c.city} ${c.bodyType} ${c.year} ${c.fuel} ${c.transmission} ${c.color ?? ''}`.toLowerCase().includes(q);
      const matchMake = this.selectedMake() === 'All' || c.make === this.selectedMake();
      const matchModel = this.selectedModelName() === 'All' || c.model === this.selectedModelName();
      const matchFuel = this.selectedFuel() === 'All' || c.fuel === this.selectedFuel();
      const matchTx   = this.selectedTransmission() === 'All' || c.transmission.includes(this.selectedTransmission());
      const matchBT   = this.selectedBodyType() === 'All' || (c.bodyType ?? '').toLowerCase() === this.selectedBodyType().toLowerCase();
      const matchPrice = c.price >= this.minPrice() && c.price <= this.maxPrice();
      const matchYear  = c.year >= this.minYear();

      // Top-level New / Used split
      const type = this.carType();
      const matchType = type === 'All' ? true :
        type === 'New'  ? c.km === 0 && c.year >= 2025 :
        /* Used */ c.km > 0 || c.year < 2025;

      // Used km sub-range
      const range = this.usedKmRange();
      const matchRange = type !== 'Used' || range === 'All' ? true :
        range === '< 50k km' ? c.km <= 50000 : c.km > 50000;

      return matchQ && matchMake && matchModel && matchFuel && matchTx && matchBT && matchPrice && matchYear && matchType && matchRange;
    });

    const sort = this.selectedSort();
    if (sort === 'Price: Low to High') cars = [...cars].sort((a,b) => a.price - b.price);
    else if (sort === 'Price: High to Low') cars = [...cars].sort((a,b) => b.price - a.price);
    else if (sort === 'Newest First') cars = [...cars].sort((a,b) => b.year - a.year);
    else if (sort === 'Top Rated') cars = [...cars].sort((a,b) => b.rating - a.rating);
    return cars;
  });

  newCount  = computed(() => {
    const make = this.selectedMake();
    return this.carsData.cars().filter(c =>
      c.km === 0 && c.year >= 2025 && (make === 'All' || c.make === make)
    ).length;
  });
  usedCount = computed(() => {
    const make = this.selectedMake();
    return this.carsData.cars().filter(c =>
      (c.km > 0 || c.year < 2025) && (make === 'All' || c.make === make)
    ).length;
  });

  selectedModel = signal<string | null>(null);

  newCarModels = computed<NewCarModel[]>(() => {
    const make = this.selectedMake();
    const modelName = this.selectedModelName();
    const newCars = this.carsData.cars().filter(c =>
      c.km === 0 && c.year >= 2025
      && (make === 'All' || c.make === make)
      && (modelName === 'All' || c.model === modelName)
    );
    const map = new Map<string, Car[]>();
    for (const c of newCars) {
      const key = `${c.make}||${c.model}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    const bt = this.selectedBodyType();
    const fuel = this.selectedFuel();
    const minP = this.minPrice();
    const maxP = this.maxPrice();
    return Array.from(map.entries()).map(([key, cars]) => {
      const [make, model] = key.split('||');
      const affordable = cars.filter(c => c.price >= minP && c.price <= maxP);
      if (affordable.length === 0) return null;
      const prices = affordable.map(c => c.price);
      const rep = affordable.find(c => c.image && !String(c.image).includes('aeplcdn'))
        ?? affordable.find(c => c.image) ?? affordable[0];
      const image = (rep.image && !String(rep.image).includes('aeplcdn'))
        ? rep.image
        : (model === 'Swift' ? 'assets/cars/swift/front.jpg' : 'assets/cars/placeholder.svg');
      return {
        make, model,
        image,
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        variantCount: affordable.length,
        bodyType: rep.bodyType ?? '',
        fuel: [...new Set(affordable.map(c => c.fuel))].join(' / '),
        rating: rep.rating,
        reviews: rep.reviews,
        badge: rep.badge,
        representativeId: rep.id,
      };
    })
    .filter((m): m is NewCarModel => m !== null &&
      (bt === 'All' || m.bodyType === bt) &&
      (fuel === 'All' || m.fuel.includes(fuel))
    )
    .sort((a, b) => b.reviews - a.reviews);
  });

  newModelVariants = computed(() => {
    const sel = this.selectedModel();
    if (!sel) return [];
    const [make, model] = sel.split('||');
    const minP = this.minPrice();
    const maxP = this.maxPrice();
    return this.carsData.cars()
      .filter(c =>
        c.make === make && c.model === model
        && c.km === 0 && c.year >= 2025
        && c.price >= minP && c.price <= maxP
      )
      .sort((a, b) => a.price - b.price);
  });

  selectModel(m: NewCarModel) { this.selectedModel.set(`${m.make}||${m.model}`); }
  clearModel() { this.selectedModel.set(null); }

  formatPriceLakh(p: number) {
    return `₹${(p / 100000).toFixed(2)}L`;
  }

  swiftGallery = [
    { src: 'assets/cars/swift/front.jpg',      label: 'Front View',     pos: 'center 65%' },
    { src: 'assets/cars/swift/rear-wide.jpg',  label: 'Side & Rear',    pos: 'center 85%' },
    { src: 'assets/cars/swift/trio.jpg',       label: 'Colour Range',   pos: 'center center' },
    { src: 'assets/cars/swift/interior.jpg',   label: 'Interior',       pos: 'center center' },
    { src: 'assets/cars/swift/rear-motion.jpg',label: 'On the Road',    pos: 'center center' },
    { src: 'assets/cars/swift/steering.jpg',   label: 'Steering',       pos: 'center center' },
  ];
  swiftColours = [
    { src: 'assets/cars/swift/colours/sizzling-red.jpg',   name: 'Sizzling Red',    hex: '#C0392B', dual: false },
    { src: 'assets/cars/swift/colours/luster-blue.jpg',    name: 'Luster Blue',     hex: '#2980B9', dual: false },
    { src: 'assets/cars/swift/colours/novel-orange.jpg',   name: 'Novel Orange',    hex: '#E67E22', dual: false },
    { src: 'assets/cars/swift/colours/magma-grey.jpg',     name: 'Magma Grey',      hex: '#7F8C8D', dual: false },
    { src: 'assets/cars/swift/colours/splendid-silver.jpg',name: 'Splendid Silver', hex: '#BDC3C7', dual: false },
    { src: 'assets/cars/swift/colours/pearl-white.jpg',    name: 'Pearl Arctic White', hex: '#ECF0F1', dual: false },
    { src: 'assets/cars/swift/colours/red-black-roof.jpg', name: 'Sizzling Red + Black Roof',  hex: '#C0392B', dual: true },
    { src: 'assets/cars/swift/colours/blue-black-roof.jpg',name: 'Luster Blue + Black Roof',   hex: '#2980B9', dual: true },
    { src: 'assets/cars/swift/colours/white-black-roof.jpg',name:'Pearl White + Black Roof',   hex: '#ECF0F1', dual: true },
  ];
  showcaseActive = this.swiftGallery[0].src;
  showcasePos    = this.swiftGallery[0].pos;
  activeColour   = this.swiftColours[0];

  showDualTone = false;
  lightboxOpen = false;

  setShowcaseImg(item: {src:string; label:string; pos:string}) {
    this.showcaseActive = item.src;
    this.showcasePos    = item.pos;
  }
  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (!this.lightboxOpen) return;
    if (e.key === 'Escape') this.lightboxOpen = false;
    if (e.key === 'ArrowRight') this.lightboxStep(1);
    if (e.key === 'ArrowLeft') this.lightboxStep(-1);
  }

  lightboxStep(dir: 1 | -1) {
    const idx = this.swiftGallery.findIndex(g => g.src === this.showcaseActive);
    const next = (idx + dir + this.swiftGallery.length) % this.swiftGallery.length;
    this.setShowcaseImg(this.swiftGallery[next]);
  }

  setColour(c: {src:string; name:string; hex:string; dual:boolean}) {
    this.activeColour   = c;
    this.showcaseActive = c.src;
    this.showcasePos    = 'center center';
  }

  formatPrice(p: number) {
    if (p >= 10000000) return `₹${(p/10000000).toFixed(1)} Cr`;
    if (p >= 100000)   return `₹${(p/100000).toFixed(0)}L`;
    return `₹${p}`;
  }

  clearAll() {
    this.carType.set('All'); this.usedKmRange.set('All');
    this.selectedFuel.set('All'); this.selectedTransmission.set('All');
    this.selectedBodyType.set('All'); this.selectedMake.set('All');
    this.selectedModelName.set('All'); this.selectedModel.set(null);
    this.minPrice.set(0); this.maxPrice.set(20000000);
    this.minYear.set(2018); this.searchQuery.set('');
  }
}
