import { Component, signal, computed, OnInit, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CarsDataService, Car } from '../../services/cars-data.service';
import { IconComponent } from '../../components/icon/icon.component';

interface NewCarVariant { name: string; minPrice: number; maxPrice: number; count?: number; }
interface NewCarHighlight { icon: string; title: string; caption: string; }
interface NewCarUpdate { text: string; date: string; }
interface NewCarMeta { priceRange: [number, number]; variants: NewCarVariant[]; highlights: NewCarHighlight[]; updates: NewCarUpdate[]; }

const NEW_CAR_META: Record<string, NewCarMeta> = {
  'Maruti Suzuki Swift': {
    priceRange: [649000, 999000],
    variants: [
      { name: 'LXi', minPrice: 649000, maxPrice: 649000 },
      { name: 'VXi', minPrice: 749000, maxPrice: 809000, count: 2 },
      { name: 'VXi S-CNG', minPrice: 819000, maxPrice: 819000 },
      { name: 'ZXi', minPrice: 899000, maxPrice: 959000, count: 2 },
      { name: 'ZXi S-CNG', minPrice: 919000, maxPrice: 919000 },
      { name: 'ZXi+', minPrice: 969000, maxPrice: 999000, count: 2 },
    ],
    highlights: [
      { icon: 'cpu', title: 'Z-Series Engine', caption: 'New 1.2L Z12E 3-cylinder engine with 81.58 PS and S-CNG option.' },
      { icon: 'shield', title: '6 Airbags Standard', caption: '6 airbags across all variants — best-in-class safety.' },
      { icon: 'cpu', title: 'SmartPlay Pro+', caption: '17.78 cm touchscreen with wireless Android Auto & Apple CarPlay.' },
      { icon: 'leaf', title: '32.85 km/kg CNG', caption: 'Best-in-segment S-CNG mileage with factory-fitted CNG kit.' },
    ],
    updates: [
      { text: 'Maruti Swift Z-Series S-CNG now available at select dealerships nationwide.', date: '15 Jun 2026' },
      { text: 'Swift 2025 receives 5-star Global NCAP rating for adult occupant protection.', date: '10 Mar 2026' },
      { text: 'New Swift launched with Z-Series engine; prices start at ₹6.49 Lakh.', date: '9 Jan 2026' },
    ],
  },
  'Tata Punch': {
    priceRange: [570000, 1067000],
    variants: [
      { name: 'Smart', minPrice: 570000, maxPrice: 680000, count: 2 },
      { name: 'Pure', minPrice: 660000, maxPrice: 761000, count: 2 },
      { name: 'Pure Plus', minPrice: 710000, maxPrice: 867000, count: 4 },
      { name: 'Pure Plus (S)', minPrice: 745000, maxPrice: 846000, count: 2 },
      { name: 'Adventure', minPrice: 820000, maxPrice: 970000, count: 3 },
      { name: 'Accomplished', minPrice: 910000, maxPrice: 1067000, count: 4 },
    ],
    highlights: [
      { icon: 'star', title: '5-Star BNCAP', caption: 'Scored 30.58/32 for adult occupants and 45/49 for child safety.' },
      { icon: 'settings', title: 'CNG Automatic', caption: 'First-in-segment CNG with AMT and paddle shifters.' },
      { icon: 'cpu', title: '10.25" Infotainment', caption: 'Cleaner dual-tone dashboard with large touchscreen.' },
      { icon: 'eye', title: '360-Degree Camera', caption: '360° surround-view camera for easy parking.' },
    ],
    updates: [
      { text: 'Tata Punch receives a price hike of up to Rs. 7,000.', date: '6 Jul 2026' },
      { text: 'Punch enters the seven lakh sales club in four years and three months.', date: '1 Feb 2026' },
      { text: 'Tata Punch achieves five-star BNCAP certification — 30.58 out of 32 points.', date: '21 Jan 2026' },
    ],
  },
  'Hyundai Creta': {
    priceRange: [1100000, 2015000],
    variants: [
      { name: 'E', minPrice: 1100000, maxPrice: 1100000 },
      { name: 'EX', minPrice: 1318000, maxPrice: 1318000 },
      { name: 'S', minPrice: 1400000, maxPrice: 1500000, count: 2 },
      { name: 'S(O)', minPrice: 1550000, maxPrice: 1620000, count: 2 },
      { name: 'SX', minPrice: 1720000, maxPrice: 1800000, count: 3 },
      { name: 'SX(O)', minPrice: 1900000, maxPrice: 2015000, count: 2 },
    ],
    highlights: [
      { icon: 'sparkles', title: 'ADAS Level 2', caption: 'Advanced driver-assistance with lane keep, auto emergency braking.' },
      { icon: 'cpu', title: 'Dual 10.25" Screens', caption: 'Panoramic dual-screen setup for driver and infotainment.' },
      { icon: 'zap', title: 'Hybrid Option', caption: '48V mild hybrid powertrain available for better fuel efficiency.' },
      { icon: 'shield', title: '6 Airbags', caption: '6 airbags standard with ESC, VSM and hill assist.' },
    ],
    updates: [
      { text: 'Hyundai Creta facelift launched with updated interior and new ADAS features.', date: '1 Apr 2026' },
      { text: 'Creta crosses 10 lakh cumulative sales milestone in India.', date: '15 Feb 2026' },
      { text: 'Creta EV variant gets new 51.4 kWh long-range battery option.', date: '10 Jan 2026' },
    ],
  },
  'Tata Nexon': {
    priceRange: [810000, 1475000],
    variants: [
      { name: 'Smart', minPrice: 810000, maxPrice: 810000 },
      { name: 'Smart+', minPrice: 920000, maxPrice: 970000, count: 2 },
      { name: 'Pure', minPrice: 1020000, maxPrice: 1060000, count: 2 },
      { name: 'Creative', minPrice: 1250000, maxPrice: 1310000, count: 2 },
      { name: 'Fearless', minPrice: 1350000, maxPrice: 1475000, count: 3 },
    ],
    highlights: [
      { icon: 'star', title: '5-Star Global NCAP', caption: 'India\'s first 5-star rated car — 16.45/17 for adult safety.' },
      { icon: 'zap', title: 'EV Option', caption: 'Available as Nexon EV with 40.5 kWh battery and 465 km range.' },
      { icon: 'cpu', title: 'Arcade.ev Ready', caption: 'Advanced connected car tech with over-the-air updates.' },
      { icon: 'shield', title: '6 Airbags', caption: '6 airbags with ADAS, front & rear parking sensors.' },
    ],
    updates: [
      { text: 'Tata Nexon facelift launched with new turbo petrol engine and ADAS features.', date: '20 May 2026' },
      { text: 'Nexon EV gets new 40.5 kWh battery with improved 465 km range.', date: '10 Mar 2026' },
      { text: 'Nexon becomes best-selling compact SUV for 2025-26 fiscal year.', date: '5 Apr 2026' },
    ],
  },
  'Kia Seltos': {
    priceRange: [1089000, 2000000],
    variants: [
      { name: 'HTK', minPrice: 1089000, maxPrice: 1089000 },
      { name: 'HTK+', minPrice: 1342000, maxPrice: 1420000, count: 2 },
      { name: 'HTX', minPrice: 1570000, maxPrice: 1650000, count: 2 },
      { name: 'HTX+', minPrice: 1735000, maxPrice: 1800000, count: 2 },
      { name: 'GTX+', minPrice: 1900000, maxPrice: 2000000, count: 2 },
    ],
    highlights: [
      { icon: 'cpu', title: 'Panoramic Dual Display', caption: '26-inch dual-screen curved display — biggest in segment.' },
      { icon: 'car', title: '3 Powertrain Options', caption: 'Petrol, Diesel and Petrol Turbo DCT available.' },
      { icon: 'sparkles', title: 'Bose Premium Sound', caption: '8-speaker Bose premium sound system in top variants.' },
      { icon: 'shield', title: 'ADAS Level 2', caption: '19 ADAS safety features including Forward Collision Warning.' },
    ],
    updates: [
      { text: 'Kia Seltos 2025 gets new panoramic curved display and updated ADAS suite.', date: '1 Jun 2026' },
      { text: 'Seltos X-Line dark edition launched with new colour options.', date: '20 Mar 2026' },
      { text: 'Kia Seltos crosses 5 lakh cumulative sales in India.', date: '10 Jan 2026' },
    ],
  },
  'Mahindra XUV700': {
    priceRange: [1399000, 2699000],
    variants: [
      { name: 'MX', minPrice: 1399000, maxPrice: 1399000 },
      { name: 'AX3', minPrice: 1649000, maxPrice: 1749000, count: 2 },
      { name: 'AX5', minPrice: 1849000, maxPrice: 1999000, count: 3 },
      { name: 'AX7', minPrice: 2099000, maxPrice: 2399000, count: 3 },
      { name: 'AX7 L', minPrice: 2499000, maxPrice: 2699000, count: 2 },
    ],
    highlights: [
      { icon: 'brain', title: 'ADAS Level 2', caption: 'AdrenoX ADAS with 5 radars and cameras for autonomous driving assistance.' },
      { icon: 'sparkles', title: 'Sony 3D Sound', caption: '12-speaker Sony 3D surround sound in top AX7 L variants.' },
      { icon: 'trending-up', title: '200 PS Diesel', caption: 'Powerful 2.2L mHawk diesel with 450 Nm torque.' },
      { icon: 'user', title: '7-Seater Option', caption: 'Available in 5 and 7-seater configurations.' },
    ],
    updates: [
      { text: 'XUV700 AX7 L gets new stargazer moonroof and updated ADAS.', date: '15 May 2026' },
      { text: 'Mahindra XUV700 waitlist reopens; deliveries within 4 weeks.', date: '5 Mar 2026' },
      { text: 'XUV700 wins Indian Car of the Year award for third consecutive year.', date: '12 Jan 2026' },
    ],
  },
};
// Colour name → hex map for swatches
const COLOUR_HEX: Record<string, string> = {
  'Pristine White':                '#F5F5F0', 'Daytona Grey':              '#6B7280',
  'Grassland Beige':               '#C4A882', 'Royal Blue':                '#1A3A8B',
  'Ocean Blue':                    '#1E5B8A', 'Pure Grey':                 '#9CA3AF',
  'Carbon Black':                  '#1A1A1A', 'Sizzling Red':              '#CC2020',
  'Sizzling Red+Black Roof':       '#CC2020', 'Luster Blue':               '#1B4F8A',
  'Luster Blue+Black Roof':        '#1B4F8A', 'Novel Orange':              '#E87820',
  'Pearl Arctic White':            '#F8F8F8', 'Pearl Arctic White+Black Roof': '#F8F8F8',
  'Magma Grey':                    '#5A5A5A', 'Splendid Silver':           '#C0C0C0',
  'Solid Fire Red':                '#CC2020', 'Grandeur Grey':             '#6B6B6B',
  'Speedy Blue':                   '#1B4F8A', 'Silky Silver':              '#C0C0C0',
  'Oxford Blue':                   '#1A3A8B', 'Brave Khaki':               '#7A7040',
  'Opulent Red':                   '#A01818', 'Celestial Blue':            '#4A90D9',
  'Kinetic Yellow':                '#F5C842', 'Auburn Silver':             '#B8A090',
  'Sizzling Orange':               '#E87820', 'Atlas White':               '#FFFFFF',
  'Denim Blue':                    '#2D4A7A', 'Titan Grey':                '#6B7280',
  'Fiery Red':                     '#CC2020', 'Starry Night':              '#1A1A3A',
  'Ranger Khaki':                  '#8A7A50', 'Phantom Black':             '#1A1A1A',
  'Typhoon Silver':                '#A0A0A0', 'Calgary White':             '#F5F5F0',
  'Orcus White':                   '#FFFFFF', 'Calypso Red':               '#CC2020',
  'Oberon Black':                  '#1A1A1A', 'Avenue White':              '#F8F8F8',
  'Teal Blue':                     '#006D75', 'Midnight Black':            '#1A1A1A',
  'Deep Forest':                   '#1A3A1A', 'Rocky Beige':               '#C4B090',
  'Aquamarine':                    '#1ABC9C', 'Infinity Blue':             '#1A2A8B',
  'Diamond White':                 '#FFFFFF', 'Pearl White':               '#F8F8F8',
  'Radiant Red':                   '#CC2020', 'Obsidian Blue':             '#1E2A5A',
  'Lunar Silver':                  '#C8C8C8', 'Super White':               '#FFFFFF',
  'Silver Metallic':               '#C0C0C0', 'Cafe White':                '#F5F0E8',
  'Aurora Silver':                 '#C4C8CC', 'Glaze Red':                 '#C82020',
  'Candy White':                   '#FFFFFF', 'Everest White':             '#F5F5F0',
  'Napoli Black':                  '#1A1A1A', 'Dazzling Silver':           '#C4C8CC',
};

import { TcoService } from '../../services/tco.service';
import { ReviewsService, CarReview } from '../../services/reviews.service';
import { SeoService } from '../../services/seo.service';
import { computeOnRoadPrice } from '../../utils/on-road-price';
import { SellersService, Seller } from '../../services/sellers.service';
import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';
import { SentimentService } from '../../services/sentiment.service';

@Component({
  selector: 'app-car-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, IconComponent],
  templateUrl: './car-detail.component.html',
  styleUrl: './car-detail.component.scss'
})
export class CarDetailComponent implements OnInit {
  activeTab = signal('overview');
  liked = signal(false);
  sellerModalOpen = signal(false);
  seller = signal<Seller | null>(null);
  enquiryModalOpen = signal(false);
  enquirySent = signal(false);
  enquirySubmitting = signal(false);
  enquiryError = signal('');
  enquiryForm = { name: '', phone: '', email: '', notes: '' };
  loan = { amount: 0, rate: 8.5, tenure: 60, emi: 0 }; // kept for template binding
  car!: Car;
  activeImg = signal(0);

  /**
   * The images this car actually has.
   *
   * Manufacturer brochure photography used to be appended here. It is not this
   * car: a buyer scrolling a gallery cannot tell a stock press shot from a
   * photograph of the vehicle they are being offered, and mixing them invites
   * exactly that confusion. A short gallery of real pictures is the honest
   * answer, and an empty one says the seller supplied none.
   */
  galleryImages(): string[] {
    return (this.car?.images?.length ? this.car.images : [this.car?.image])
      .filter(Boolean) as string[];
  }
  notFound = false;
  carLoaded = false;

  // On-road price
  // Colour picker
  selectedColour = signal('');
  modelColours = computed(() => {
    if (!this.car) return [];
    const all = this.carsData.cars();
    const seen = new Set<string>();
    const result: { name: string; hex: string; variantId: string }[] = [];
    all.filter(c => c.make === this.car.make && c.model === this.car.model)
       .forEach(c => {
         if (c.color && !seen.has(c.color)) {
           seen.add(c.color);
           result.push({ name: c.color, hex: COLOUR_HEX[c.color] ?? '#888888', variantId: c.id });
         }
       });
    return result;
  });

  // EMI state as signals so emiBreakdown can react
  loanAmount = signal(0);
  loanRate = signal(8.5);
  loanTenure = signal(60);
  loanEmi = signal(0);

  // EMI breakdown computed
  emiBreakdown = computed(() => {
    const emi = this.loanEmi();
    const tenure = this.loanTenure();
    const principal = this.loanAmount();
    const total = emi * tenure;
    return { total, interest: total - principal, principal };
  });

  selectedState = signal('Maharashtra');

  // Registration charge % by state (as per state motor vehicle acts, 2024)
  // Source: respective state transport dept notifications
  private readonly STATE_REG: Record<string, number> = {
    'Andhra Pradesh': 0.09,
    'Arunachal Pradesh': 0.08,
    'Assam': 0.08,
    'Bihar': 0.09,
    'Chhattisgarh': 0.08,
    'Goa': 0.09,
    'Gujarat': 0.06,
    'Haryana': 0.08,
    'Himachal Pradesh': 0.06,
    'Jharkhand': 0.08,
    'Karnataka': 0.13,
    'Kerala': 0.10,
    'Madhya Pradesh': 0.08,
    'Maharashtra': 0.11,
    'Manipur': 0.06,
    'Meghalaya': 0.06,
    'Mizoram': 0.06,
    'Nagaland': 0.06,
    'Odisha': 0.08,
    'Punjab': 0.08,
    'Rajasthan': 0.06,
    'Sikkim': 0.06,
    'Tamil Nadu': 0.10,
    'Telangana': 0.09,
    'Tripura': 0.06,
    'Uttar Pradesh': 0.08,
    'Uttarakhand': 0.08,
    'West Bengal': 0.07,
    'Delhi': 0.04,           // EVs 0%, petrol/diesel 4–12.5% — using midpoint for petrol
    'Chandigarh': 0.06,
    'Puducherry': 0.09,
    'Andaman & Nicobar': 0.06,
    'Dadra & Nagar Haveli': 0.06,
    'Daman & Diu': 0.04,
    'Jammu & Kashmir': 0.06,
    'Ladakh': 0.04,
    'Lakshadweep': 0.04,
  };

  states = Object.keys(this.STATE_REG).sort();

  // Ownership cost
  annualKm = signal(15000);
  fuelPrice = signal(106);
  fuelPriceMin = 85; fuelPriceMax = 130; fuelPriceUnit = '/L';

  // Reviews (Supabase-backed)
  reviews = signal<CarReview[]>([]);
  userReview = { rating: 0, title: '', body: '', name: '', city: '' };
  selectedVideoFile: File | null = null;
  videoPreviewUrl: string | null = null;
  showReviewForm = signal(false);
  reviewSubmitted = signal(false);
  reviewError = signal('');
  hoverRating = signal(0);

  bookTestDrive() {
    if (this.car) {
      this.router.navigate(['/test-drive'], { queryParams: { carId: this.car.id } });
    }
  }

  async openContactSeller() {
    const user = this.auth.currentUser();
    if (user?.role === 'admin' || user?.role === 'seller') {
      if (!this.seller()) {
        const s = await this.sellersSvc.getForCar(this.car.id);
        this.seller.set(s);
      }
      this.sellerModalOpen.set(true);
    } else {
      // Pre-fill form from logged-in user if available
      if (user) {
        this.enquiryForm.name  = this.enquiryForm.name  || user.name;
        this.enquiryForm.email = this.enquiryForm.email || user.email;
      }
      this.enquiryModalOpen.set(true);
    }
  }

  async submitEnquiry() {
    if (!this.enquiryForm.name || !this.enquiryForm.phone) {
      this.enquiryError.set('Name and phone number are required.');
      return;
    }
    this.enquiryError.set('');
    this.enquirySubmitting.set(true);
    const { error } = await this.sb.client.from('car_enquiries').insert({
      car_id:      this.car.id,
      buyer_name:  this.enquiryForm.name,
      buyer_phone: this.enquiryForm.phone,
      buyer_email: this.enquiryForm.email || null,
      notes:       this.enquiryForm.notes || null,
    });
    this.enquirySubmitting.set(false);
    if (error) {
      this.enquiryError.set('Could not send enquiry. Please try again.');
    } else {
      this.enquirySent.set(true);
      this.enquiryForm = { name: '', phone: '', email: '', notes: '' };
      this._trackEnquiry();
    }
  }

  private async _trackListingView(): Promise<void> {
    const buyerId = this.auth.currentUser()?.id;
    if (!buyerId) return;
    const seller = await this.sellersSvc.getForCar(this.car.id).catch(() => null);
    if (!seller?.email) return;
    this.sentimentSvc.trackPublic(seller.email, buyerId, 'listing_view');
  }

  private async _trackEnquiry(): Promise<void> {
    const buyerId = this.auth.currentUser()?.id;
    if (!buyerId) return;
    const seller = await this.sellersSvc.getForCar(this.car.id).catch(() => null);
    if (!seller?.email) return;
    this.sentimentSvc.trackPublic(seller.email, buyerId, 'enquiry');
  }

  constructor(private route: ActivatedRoute, private router: Router, private carsData: CarsDataService, private seo: SeoService, public tco: TcoService, public reviewsSvc: ReviewsService, private sellersSvc: SellersService, public auth: AuthService, private sb: SupabaseService, private sentimentSvc: SentimentService) {
    effect(() => {
      if (this.carLoaded || this.carsData.loading()) return;
      // Ids are opaque strings — coercing to Number turned non-numeric ids
      // (demo cars, any future slug) into NaN, which missed the lookup and
      // silently fell back to the first car in the catalogue.
      const id = this.route.snapshot.paramMap.get('id') ?? '';
      this.resolveCar(id);
    });
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab) this.activeTab.set(tab);
    if (!this.carsData.loading()) {
      this.resolveCar(id);
    }
  }


  private resolveCar(id: string | number) {
    if (this.carLoaded) return;
    const found = this.carsData.getById(String(id));
    const all = this.carsData.getAll();
    if (found) {
      this.car = found;
      this.carLoaded = true;
    } else if (all.length > 0) {
      this.notFound = true;
      this.car = all[0];
      this.carLoaded = true;
    }
    if (this.carLoaded) {
      this.loan.amount = this.car.price;
      this.calcEmi();
      if (this.car.color) this.selectedColour.set(this.car.color);
      this.loadReviews();
      this.seo.setCarDetail(this.car.make, this.car.model, this.car.year, this.car.price, this.car.city || 'India');
      this._trackListingView();
      const fuel = this.car.fuel;
      if (fuel === 'Diesel') { this.fuelPrice.set(92); this.fuelPriceMin = 80; this.fuelPriceMax = 110; this.fuelPriceUnit = '/L'; }
      else if (fuel === 'CNG') { this.fuelPrice.set(85); this.fuelPriceMin = 70; this.fuelPriceMax = 110; this.fuelPriceUnit = '/kg'; }
      else if (fuel === 'Electric') { this.fuelPriceUnit = '/kWh'; }
      else { this.fuelPrice.set(106); this.fuelPriceMin = 90; this.fuelPriceMax = 130; this.fuelPriceUnit = '/L'; }
    }
  }

  calcEmi() {
    const r = this.loan.rate / 100 / 12;
    const n = this.loan.tenure;
    const p = this.loan.amount;
    this.loan.emi = Math.round(p * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
    this.loanAmount.set(this.loan.amount);
    this.loanRate.set(this.loan.rate);
    this.loanTenure.set(this.loan.tenure);
    this.loanEmi.set(this.loan.emi);
  }

  // On-road price. The rules, and why GST and cess are not added to an
  // ex-showroom price that already contains them, live in utils/on-road-price.
  onRoadPrice = computed(() => {
    if (!this.car) return null;
    return computeOnRoadPrice(
      this.car.price,
      this.car.fuel ?? 'Petrol',
      (this.car as any).body_type ?? (this.car as any).bodyType ?? '',
      this.STATE_REG[this.selectedState()] ?? 0.08,
    );
  });

  // Ownership cost (annual)
  ownershipCost = computed(() => {
    if (!this.car) return null;
    const km = this.annualKm();
    const fp = this.fuelPrice();
    // estimate mileage from specs or default
    const mileageSpec = this.car.specs?.find(s => s.label === 'Mileage');
    const mileage = mileageSpec ? parseFloat(mileageSpec.value) : (this.car.fuel === 'Electric' ? 0 : 18);
    const fuelCost = this.car.fuel === 'Electric' ? Math.round(km * 1.5) : Math.round((km / mileage) * fp);
    const maintenance = Math.round(this.car.price * 0.012);
    const insurance = Math.round(this.car.price * 0.025);
    const depreciation = Math.round(this.car.price * 0.15);
    const total = fuelCost + maintenance + insurance + depreciation;
    return { fuelCost, maintenance, insurance, depreciation, total, perKm: Math.round(total / km) };
  });

  // Resale prediction
  resaleValue = computed(() => {
    if (!this.car) return null;
    const age = new Date().getFullYear() - this.car.year;
    const depRate = this.car.fuel === 'Electric' ? 0.12 : 0.15;
    const val = Math.round(this.car.price * Math.pow(1 - depRate, Math.max(age, 1)));
    return { value: val, pct: Math.round((val / this.car.price) * 100) };
  });

  async loadReviews() {
    const data = await this.reviewsSvc.getReviewsForCar(String(this.car.id));
    this.reviews.set(data);
  }

  onVideoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { this.reviewError.set('Video must be under 50 MB'); return; }
    this.selectedVideoFile = file;
    this.videoPreviewUrl = URL.createObjectURL(file);
    this.reviewError.set('');
  }

  async submitReview() {
    if (!this.userReview.rating || !this.userReview.body || !this.userReview.name) {
      this.reviewError.set('Please fill in your name, a rating, and your review.');
      return;
    }
    this.reviewError.set('');
    let videoUrl: string | null = null;
    if (this.selectedVideoFile) {
      videoUrl = await this.reviewsSvc.uploadVideo(this.selectedVideoFile, String(this.car.id));
    }
    const avatar = this.userReview.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
    const saved = await this.reviewsSvc.submitReview({
      car_id: String(this.car.id),
      user_name: this.userReview.name,
      user_city: this.userReview.city || 'India',
      avatar,
      rating: this.userReview.rating,
      title: this.userReview.title || 'My Review',
      body: this.userReview.body,
      video_url: videoUrl,
    });
    if (saved) {
      this.reviews.update(r => [saved, ...r]);
      this.reviewSubmitted.set(true);
      this.showReviewForm.set(false);
      this.selectedVideoFile = null;
      this.videoPreviewUrl = null;
      this.userReview = { rating: 0, title: '', body: '', name: '', city: '' };
    } else {
      this.reviewError.set('Failed to submit review. Please try again.');
    }
  }

  avgRating = computed(() => {
    const all = this.reviews().map(r => r.rating);
    if (!all.length) return '0.0';
    return (all.reduce((a, b) => a + b, 0) / all.length).toFixed(1);
  });

  waLink(phone: string) { return 'https://wa.me/' + phone.replace(/[^0-9]/g, ''); }

  formatPrice(p: number) { return p >= 100000 ? `₹${(p / 100000).toFixed(1)}L` : `₹${p.toLocaleString()}`; }
  stars(n: number) { return Array.from({length: 5}, (_, i) => i < n ? '★' : '☆'); }

  get isNewCar() { return this.car?.km === 0 && this.car?.year >= 2024; }
  get newCarMeta(): NewCarMeta | null {
    if (!this.isNewCar) return null;
    const key = `${this.car.make} ${this.car.model}`;
    return NEW_CAR_META[key] ?? null;
  }
  formatLakh(p: number) { return `₹${(p / 100000).toFixed(2)} Lakh`; }
  formatLakhRange(min: number, max: number) {
    if (min === max) return `₹${(min / 100000).toFixed(2)} Lakh`;
    return `₹${(min / 100000).toFixed(2)} - ${(max / 100000).toFixed(2)} Lakh`;
  }

  similarCars = computed(() => {
    if (!this.car || !this.isNewCar) return [];
    const all = this.carsData.cars();
    const seen = new Set<string>();
    const result: Car[] = [];
    const candidates = all
      .filter(c =>
        c.km === 0 && c.year >= 2024 &&
        !(c.make === this.car.make && c.model === this.car.model) &&
        (c.bodyType === this.car.bodyType || Math.abs(c.price - this.car.price) < 500000)
      )
      .sort((a, b) => Math.abs(a.price - this.car.price) - Math.abs(b.price - this.car.price));
    for (const c of candidates) {
      const key = `${c.make}||${c.model}`;
      if (!seen.has(key)) { seen.add(key); result.push(c); }
      if (result.length >= 5) break;
    }
    return result;
  });

  getHex(colourName: string): string { return COLOUR_HEX[colourName] ?? '#888888'; }
  isLightColour(name: string): boolean {
    const hex = (COLOUR_HEX[name] ?? '#888888').replace('#', '');
    const r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
    return (r * 0.299 + g * 0.587 + b * 0.114) > 160;
  }

  getMileage(car: Car) {
    const spec = car.specs?.find(s => s.label.toLowerCase().includes('mileage') && !s.label.toLowerCase().includes('cng'));
    return spec?.value ?? '—';
  }
}
