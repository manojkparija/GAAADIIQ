import { Component, signal, computed, OnInit, inject } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CarsDataService, Car, isShowable, startingPrice } from '../../services/cars-data.service';
import { TcoService, TcoBreakdown } from '../../services/tco.service';
import { SeoService } from '../../services/seo.service';
import { IconComponent } from '../../components/icon/icon.component';
import { TranslatePipe } from '../../pipes/translate.pipe';

const COMPARE_KEY = 'gaadiiq_compare_keys';

@Component({
  selector: 'app-compare',
  standalone: true,
  imports: [RouterLink, CommonModule, FormsModule, IconComponent, TranslatePipe],
  templateUrl: './compare.component.html',
  styleUrl: './compare.component.scss'
})
export class CompareComponent implements OnInit {
  searchA = signal(''); searchB = signal(''); searchC = signal('');
  selected = signal<(Car | null)[]>([null, null, null]);
  showDropdown = signal<number>(-1);

  specRows = [
    { label: 'Price', key: 'price', format: (v: any) => `₹${(+v/100000).toFixed(1)}L`, higher: false },
    { label: 'Year', key: 'year', format: (v: any) => String(v), higher: true },
    { label: 'KM Driven', key: 'km', format: (v: any) => `${(+v).toLocaleString()} km`, higher: false },
    { label: 'Fuel Type', key: 'fuel', format: (v: any) => String(v), higher: null },
    { label: 'Transmission', key: 'transmission', format: (v: any) => String(v), higher: null },
    { label: 'Owners', key: 'owners', format: (v: any) => String(v) || '—', higher: null },
    { label: 'Rating', key: 'rating', format: (v: any) => `${v} ★`, higher: true },
    { label: 'Reviews', key: 'reviews', format: (v: any) => String(v), higher: true },
    { label: 'City', key: 'city', format: (v: any) => String(v) || '—', higher: null },
  ];

  constructor(
    public carsData: CarsDataService,
    private seo: SeoService,
    public tco: TcoService,
    private route: ActivatedRoute,
  ) {
    seo.setPage('Compare Cars', 'Compare up to 3 cars side by side. Specs, features, price, AI valuation — all in one place.');
  }

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      let keys: string[] = [];
      if (params['keys']) {
        keys = String(params['keys']).split(',').map(k => k.trim()).filter(Boolean);
      } else {
        try {
          const raw = sessionStorage.getItem(COMPARE_KEY);
          if (raw) keys = JSON.parse(raw);
        } catch { /* ignore */ }
      }
      if (!keys.length) return;

      const cars = this.carsData.cars();
      const picked: (Car | null)[] = [null, null, null];
      let slot = 0;
      for (const key of keys) {
        if (slot >= 3) break;
        const [make, model] = key.split('||');
        // Prefer a row with a photograph. A key saved before the model's
        // images were removed would otherwise reopen a blank card, and the
        // compare page would keep showing what the rest of the site stopped.
        const matches = cars.filter(c => c.make === make && c.model === model);
        const car = matches.find(c => c.km === 0 && c.year >= 2024 && isShowable(c))
          ?? matches.find(isShowable)
          ?? null;
        if (car) {
          picked[slot] = car;
          slot++;
        }
      }
      if (slot > 0) this.selected.set(picked);
    });
  }

  search(slot: number) {
    return [this.searchA, this.searchB, this.searchC][slot]();
  }

  popularPicks = computed(() => {
    const seen = new Set<string>();
    const picks: Car[] = [];
    for (const c of this.carsData.cars().filter(isShowable)) {
      if (!seen.has(c.make)) { seen.add(c.make); picks.push(c); }
      if (picks.length === 6) break;
    }
    return picks;
  });

  /**
   * What the picker offers.
   *
   * Catalogue rows with no photograph are left out, as they are on the New
   * Cars and Browse grids. Comparing two blank cards is not a comparison, and
   * offering a car the rest of the site has stopped showing contradicts it.
   * Adverts stay: see isShowable.
   */
  filtered(slot: number) {
    const q = this.search(slot).toLowerCase();
    const all = this.carsData.cars().filter(isShowable);
    if (!q) return all.slice(0, 10);
    return all.filter(c => `${c.make} ${c.model} ${c.year}`.toLowerCase().includes(q)).slice(0, 8);
  }

  selectCar(slot: number, car: Car) {
    this.selected.update(arr => { const n = [...arr]; n[slot] = car; return n; });
    [this.searchA, this.searchB, this.searchC][slot].set('');
    this.showDropdown.set(-1);
  }

  removeCar(slot: number) {
    this.selected.update(arr => { const n = [...arr]; n[slot] = null; return n; });
  }

  /**
   * The value a spec row compares.
   *
   * `price` is redirected to the entry trim, because the row's own figure is
   * not a price the car is sold at — and this row awards a crown, so comparing
   * on it declares a winner between two numbers that do not exist.
   */
  getVal(car: Car, key: string): any {
    return key === 'price' ? this.startsAt(car) : (car as any)[key];
  }

  isWinner(key: string, car: Car, higher: boolean | null): boolean {
    if (higher === null) return false;
    const sel = this.selected().filter(Boolean) as Car[];
    if (sel.length < 2) return false;
    // Through getVal, so the crown is decided on the same number the row
    // displays rather than on the raw field beside it.
    const vals = sel.map(c => parseFloat(String(this.getVal(c, key))));
    const myVal = parseFloat(String(this.getVal(car, key)));
    if (isNaN(myVal)) return false;
    return higher ? myVal === Math.max(...vals) : myVal === Math.min(...vals);
  }

  activeCars = computed(() => this.selected().filter(Boolean) as Car[]);
  minTco = computed(() => Math.min(...this.activeCars().map(c => this.tco.calculateTco(c).netCost5yr)));

  hasFeature(car: Car, feature: string): boolean {
    return (car.features || []).some(ft => ft.toLowerCase().includes(feature.toLowerCase()));
  }

  formatPrice(p: number) { return `₹${(p/100000).toFixed(1)}L`; }

  /**
   * What a car on this page costs from.
   *
   * Comparing two cars on the catalogue row's figure compares two numbers
   * neither is sold at — the Fronx row reads ₹9.3L against an entry trim of
   * ₹6.84L. An advert has no trims, so this is its own price, which is right:
   * a used car is one car at one price.
   */
  startsAt(car: Car) { return startingPrice(car); }


  /**
   * A comparison row without a picture is hard to read, and most catalogue
   * cars carry no image of their own — so fall back to the manufacturer's
   * brochure photography before the placeholder.
   */
  optimisedImageFor(car: Car): string {
    return this.optimisedImage(
      (car as any)?.image || 'assets/cars/placeholder.svg',
    );
  }

  optimisedImage(url: string): string {
    if (!url) return 'assets/cars/placeholder.svg';
    const match = url.match(/res\.cloudinary\.com\/([^/]+)\/image\/upload\/(?:[^/]+\/)?(.+)/);
    if (match) {
      const [, cloud, publicId] = match;
      return `https://res.cloudinary.com/${cloud}/image/upload/f_auto,q_auto,w_600,h_380,c_fill/${publicId}`;
    }
    return url;
  }

  onImgLoad(e: Event) { (e.target as HTMLImageElement).style.opacity = '1'; }
  onImgError(e: Event) {
    const img = e.target as HTMLImageElement;
    img.onerror = null;
    img.src = 'assets/cars/placeholder.svg';
    img.style.opacity = '1';
  }

  /**
   * Five-year cost, priced from the trim the page is quoting.
   *
   * Registration, insurance and resale are all percentages of the purchase
   * price, so an error there is multiplied through the whole table rather than
   * carried.
   */
  getTco(car: Car): TcoBreakdown {
    return this.tco.calculateTco({ ...car, price: this.startsAt(car) });
  }
  tcoRows: { label: string; key: keyof TcoBreakdown }[] = [
    { label: 'Purchase Price', key: 'purchasePrice' },
    { label: 'Registration (9%)', key: 'registration' },
    { label: 'Insurance (5yr)', key: 'insurance5yr' },
    { label: 'Fuel Cost (5yr)', key: 'fuel5yr' },
    { label: 'Maintenance (5yr)', key: 'maintenance5yr' },
    { label: '5yr Resale Value', key: 'resaleValue' },
    { label: 'Net 5-yr Cost', key: 'netCost5yr' },
  ];
}
