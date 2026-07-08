import { Component, signal, computed, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { CarCardComponent } from '../../components/car-card/car-card.component';
import { CarsDataService, Car } from '../../services/cars-data.service';

@Component({
  selector: 'app-listings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CarCardComponent],
  templateUrl: './listings.component.html',
  styleUrl: './listings.component.scss'
})
export class ListingsComponent implements OnInit {
  constructor(private route: ActivatedRoute, private carsData: CarsDataService) {}

  get loading() { return this.carsData.loading; }

  searchQuery        = signal('');
  selectedFuel       = signal('All');
  selectedTransmission = signal('All');
  selectedBodyType   = signal('All');
  selectedSort       = signal('Relevance');
  selectedMake       = signal('All');
  maxPrice           = signal(20000000);
  minYear            = signal(2018);
  sidebarOpen        = signal(false);

  // Top-level car type: 'All' | 'New' | 'Used'
  carType = signal<'All' | 'New' | 'Used'>('All');

  // Used-only sub-filter: 'All' | '< 50k km' | '> 50k km'
  usedKmRange = signal<'All' | '< 50k km' | '> 50k km'>('All');

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      this.selectedMake.set(params['make'] || 'All');
      this.selectedFuel.set(params['fuel'] || 'All');
      this.selectedBodyType.set(params['bodyType'] || 'All');
      if (params['carType']) this.carType.set(params['carType'] as any);
      if (params['maxPrice']) this.maxPrice.set(+params['maxPrice']);
      if (params['transmission']) this.selectedTransmission.set(params['transmission']);
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
      const matchQ  = !q || `${c.make} ${c.model} ${c.city} ${c.bodyType} ${c.year} ${c.fuel}`.toLowerCase().includes(q);
      const matchMake = this.selectedMake() === 'All' || c.make === this.selectedMake();
      const matchFuel = this.selectedFuel() === 'All' || c.fuel === this.selectedFuel();
      const matchTx   = this.selectedTransmission() === 'All' || c.transmission.includes(this.selectedTransmission());
      const matchBT   = this.selectedBodyType() === 'All' || c.bodyType === this.selectedBodyType();
      const matchPrice = c.price <= this.maxPrice();
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

      return matchQ && matchMake && matchFuel && matchTx && matchBT && matchPrice && matchYear && matchType && matchRange;
    });

    const sort = this.selectedSort();
    if (sort === 'Price: Low to High') cars = [...cars].sort((a,b) => a.price - b.price);
    else if (sort === 'Price: High to Low') cars = [...cars].sort((a,b) => b.price - a.price);
    else if (sort === 'Newest First') cars = [...cars].sort((a,b) => b.year - a.year);
    else if (sort === 'Top Rated') cars = [...cars].sort((a,b) => b.rating - a.rating);
    return cars;
  });

  newCount  = computed(() => this.carsData.cars().filter(c => c.km === 0 && c.year >= 2025).length);
  usedCount = computed(() => this.carsData.cars().filter(c => c.km > 0 || c.year < 2025).length);

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
    this.maxPrice.set(20000000); this.minYear.set(2018); this.searchQuery.set('');
  }
}
