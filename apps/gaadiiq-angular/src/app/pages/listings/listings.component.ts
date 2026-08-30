import { Component, signal, computed, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { CarCardComponent } from '../../components/car-card/car-card.component';
import { IconComponent } from '../../components/icon/icon.component';
import { CarsDataService, Car, PLACEHOLDER } from '../../services/cars-data.service';
import { ImgFallbackDirective } from '../../directives/img-fallback.directive';
import { CustomSelectComponent } from '../../components/custom-select/custom-select.component';
import { TranslatePipe } from '../../pipes/translate.pipe';

interface NewCarModel {
  make: string; model: string; image: string;
  minPrice: number; maxPrice: number;
  variantCount: number; bodyType: string; fuel: string;
  rating: number; reviews: number; badge: string;
  representativeId: string;
}

@Component({
  selector: 'app-listings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CarCardComponent, IconComponent, ImgFallbackDirective, CustomSelectComponent, TranslatePipe],
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
        type === 'New'  ? c.km === 0 && c.year >= 2024 :
        /* Used */ c.km > 0 || c.year < 2024;

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
      c.km === 0 && c.year >= 2024 && (make === 'All' || c.make === make)
    ).length;
  });
  usedCount = computed(() => {
    const make = this.selectedMake();
    return this.carsData.cars().filter(c =>
      (c.km > 0 || c.year < 2024) && (make === 'All' || c.make === make)
    ).length;
  });

  selectedModel = signal<string | null>(null);

  newCarModels = computed<NewCarModel[]>(() => {
    const make = this.selectedMake();
    const modelName = this.selectedModelName();
    const newCars = this.carsData.cars().filter(c =>
      c.km === 0 && c.year >= 2024
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
      // The published trims are the source of truth for both the band and the
      // count, exactly as the detail page treats them. Reading `c.price` alone
      // was wrong twice over: it is one hand-maintained catalogue figure per
      // row, so a Fronx card quoted "₹9.30L onwards" while its own detail page
      // read the trims and said "₹6.84 - 11.98 Lakh"; and counting rows called
      // seventeen trims "1 Variant", because the catalogue holds one row per
      // model-year, not one per trim.
      //
      // The catalogue figure stays as the fallback for a model whose trims are
      // unpriced or absent — that is the only price such a car has.
      const prices = affordable.flatMap(c => {
        const lo = c.variantPriceMin;
        const hi = c.variantPriceMax;
        return lo != null && hi != null ? [lo, hi] : [c.price];
      });
      // Which row's photograph the card shows.
      //
      // The old test was `c.image`, and mapCatalogueCar fills `image` with a
      // placeholder for a car that has none — so every row passed and the
      // first won, showing a blank while a later model year had photographs.
      // Same defect the New Cars grid had.
      //
      // The bundled Swift drawing is gone with it: the database is the only
      // source of a car's photographs, so a Swift with none reads the same as
      // any other model rather than keeping a picture after a deletion.
      const hasPhoto = (c: Car) =>
        !!c.image && c.image !== PLACEHOLDER && !String(c.image).includes('aeplcdn');
      const rep = affordable.find(hasPhoto) ?? affordable[0];
      const image = hasPhoto(rep) ? rep.image : PLACEHOLDER;
      return {
        make, model,
        image,
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        // Trims across every row of this model, falling back to the row count
        // for a model with none — one row is still one thing to choose.
        variantCount: Math.max(
          affordable.reduce((sum, c) => sum + (c.variantCount ?? 0), 0),
          affordable.length,
        ),
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
      (fuel === 'All' || m.fuel.includes(fuel)) &&
      // A card with no photograph is not shown, as on the New Cars grid.
      // "No Image Available" on a row of cars reads as a broken page rather
      // than as a catalogue gap; a model waits until it has a picture.
      m.image !== PLACEHOLDER
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
        && c.km === 0 && c.year >= 2024
        && c.price >= minP && c.price <= maxP
      )
      .sort((a, b) => a.price - b.price);
  });

  /**
   * Open a model.
   *
   * This used to set a filter, drilling into a variant list inside the
   * listings page. "Explore Variants" reads as an invitation to go and look at
   * the car, and the car's own page is where its photographs, trims, price
   * breakdown and specification actually are — a filtered strip of the grid
   * was a smaller version of the page the buyer was already on.
   */
  selectModel(m: NewCarModel) {
    if (m.representativeId) {
      void this.router.navigate(['/cars', m.representativeId]);
      return;
    }
    // No id to open — fall back to the old in-page filter rather than
    // swallowing the click.
    this.selectedModel.set(`${m.make}||${m.model}`);
  }
  clearModel() { this.selectedModel.set(null); }

  formatPriceLakh(p: number) {
    return `₹${(p / 100000).toFixed(2)}L`;
  }

  /**
   * Published trims across the rows of the model being drilled into.
   *
   * The header counted `newModelVariants().length`, which is catalogue rows —
   * one per model-year — so a Fronx with twelve published trims announced
   * "1 variant". Exactly the fault the model card had one click earlier; this
   * view was simply missed when that was fixed.
   */
  selectedModelTrimCount(): number {
    const rows = this.newModelVariants();
    return Math.max(
      rows.reduce((sum, c) => sum + (c.variantCount ?? 0), 0),
      rows.length,
    );
  }

  /** The band a row's trims span, or its catalogue price when it has none. */
  variantCardPrice(c: Car): string {
    const lo = c.variantPriceMin;
    const hi = c.variantPriceMax;
    if (lo == null || hi == null) return this.formatPriceLakh(c.price);
    return lo === hi
      ? this.formatPriceLakh(lo)
      : `${this.formatPriceLakh(lo)} – ${this.formatPriceLakh(hi)}`;
  }

  /** "EMI from" already says from, so quote the cheapest trim. */
  variantEmiBase(c: Car): number {
    return c.variantPriceMin ?? c.price;
  }

  swiftGallery = [
    { src: 'assets/cars/maruti-swift/front.svg',      label: 'Front View',     pos: 'center 65%' },
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
