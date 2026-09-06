import { Component, signal, computed, OnInit, OnDestroy, effect, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CarsDataService, Car, CarVariant, isShowable, startingPrice, capacityLabel, economyLabel } from '../../services/cars-data.service';
import { IconComponent } from '../../components/icon/icon.component';
import { MarketPositionComponent } from '../../components/market-position/market-position.component';
import { VehicleScorecardComponent } from '../../components/vehicle-scorecard/vehicle-scorecard.component';
import { ListingActivityComponent } from '../../components/listing-activity/listing-activity.component';
import { DemandService, ListingActivity } from '../../services/demand.service';
import {
  MarketPosition,
  VehicleScore,
  bandFromHeuristic,
  marketPosition,
  vehicleScore,
} from '../../utils/market-position';

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
import { ForecastYear, ResaleForecastService } from '../../services/resale-forecast.service';
import { ReviewsService, CarReview } from '../../services/reviews.service';
import { OffersModalComponent } from '../../components/offers-modal/offers-modal.component';
import { SeoService } from '../../services/seo.service';
import { computeOnRoadPrice } from '../../utils/on-road-price';
import { SellersService, Seller } from '../../services/sellers.service';
import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';
import { SentimentService, BUYER_TRACKING_CONSENT } from '../../services/sentiment.service';
import { ImgFallbackDirective } from '../../directives/img-fallback.directive';
import { CustomSelectComponent } from '../../components/custom-select/custom-select.component';
import { NativeService } from '../../services/native.service';
import { TranslatePipe } from '../../pipes/translate.pipe';

/**
 * How far from this car's entry price another model may sit and still be
 * offered as a comparison.
 *
 * Proportional rather than a flat rupee figure, because a flat one is the wrong
 * shape at both ends: the ₹5L window this replaces was 73% of a ₹6.84L Fronx —
 * wide enough to suggest a car at nearly twice the money — and 10% of a ₹50L
 * car, tight enough to return nothing at all.
 *
 * 35% is deliberately generous. A buyer looking at a ₹6.84L Fronx will stretch
 * to ₹9.2L; they will not cross-shop a ₹16.2L Grand Vitara, which is what
 * prompted this. The floor keeps the cheapest end from collapsing to a window
 * so narrow that a real alternative is excluded on a ₹20,000 difference.
 */
function similarPriceWindow(anchor: number): number {
  return Math.max(anchor * 0.35, 150000);
}

@Component({
  selector: 'app-car-detail',
  standalone: true,
  imports: [
    CommonModule, RouterLink, FormsModule, IconComponent, ImgFallbackDirective,
    MarketPositionComponent, VehicleScorecardComponent, ListingActivityComponent, CustomSelectComponent, OffersModalComponent, TranslatePipe],
  templateUrl: './car-detail.component.html',
  styleUrl: './car-detail.component.scss'
})
export class CarDetailComponent implements OnInit, OnDestroy {
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

  // ── 360° spin ──────────────────────────────────────────────────────────────
  //
  // A turntable sequence, scrubbed by dragging. Deliberately not an autoplaying
  // animation: a buyer looking at a 360 wants to stop on the C-pillar or the
  // wheel arch, and a loop that keeps turning under them takes that away. It
  // rotates on its own only until first touched, purely to signal that it can.

  spinMode = signal(false);
  spinFrame = signal(0);
  /** Frames the browser has actually fetched — the viewer waits for all of them. */
  spinLoaded = signal(0);
  private spinDragFrom: { x: number; frame: number } | null = null;
  private spinHintTimer: ReturnType<typeof setInterval> | null = null;

  spinImages(): string[] { return this.car?.spinImages ?? []; }
  hasSpin(): boolean { return this.spinImages().length > 0; }
  spinReady(): boolean { return this.spinLoaded() >= this.spinImages().length; }

  spinProgress(): number {
    const total = this.spinImages().length;
    return total ? Math.round((this.spinLoaded() / total) * 100) : 0;
  }

  toggleSpin(): void {
    const next = !this.spinMode();
    this.spinMode.set(next);
    this.stopSpinHint();
    if (next) {
      // One idle rotation so the control reads as "drag me" without a caption.
      // Cleared the moment a pointer lands, and on leaving spin mode.
      this.spinHintTimer = setInterval(() => this.stepSpin(1), 90);
    }
  }

  private stopSpinHint(): void {
    if (this.spinHintTimer) { clearInterval(this.spinHintTimer); this.spinHintTimer = null; }
  }

  onSpinFrameLoad(): void { this.spinLoaded.update(n => n + 1); }

  private stepSpin(delta: number): void {
    const total = this.spinImages().length;
    if (!total) return;
    this.spinFrame.set(((this.spinFrame() + delta) % total + total) % total);
  }

  startSpin(event: PointerEvent): void {
    this.stopSpinHint();
    this.spinDragFrom = { x: event.clientX, frame: this.spinFrame() };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  moveSpin(event: PointerEvent): void {
    if (!this.spinDragFrom) return;
    const total = this.spinImages().length;
    // A full drag across the viewer turns the car once, whatever the frame
    // count and whatever the screen width — so the gesture feels the same on a
    // phone and a desktop, and on a 24-frame set and a 72-frame one.
    const width = (event.currentTarget as HTMLElement)?.clientWidth || 600;
    const moved = (event.clientX - this.spinDragFrom.x) / width;
    const next = this.spinDragFrom.frame + Math.round(moved * total);
    this.spinFrame.set(((next % total) + total) % total);
  }

  endSpin(): void { this.spinDragFrom = null; }

  /**
   * Full-screen viewer.
   *
   * A thumbnail strip answers "which photograph", not "what does this panel
   * look like" — and on a car that is the question buyers actually have:
   * paint finish, upholstery stitching, the scuff on a bumper. So the main
   * image opens full-screen, where it can be magnified and panned, and the
   * keyboard moves between shots without reaching for the mouse.
   */
  lightboxOpen = signal(false);
  zoom = signal(1);
  panX = signal(0);
  panY = signal(0);
  private dragFrom: { x: number; y: number; panX: number; panY: number } | null = null;

  readonly maxZoom = 4;
  readonly minZoom = 1;

  openLightbox(index = this.activeImg()): void {
    if (!this.galleryImages().length) return;
    this.activeImg.set(index);
    this.resetZoom();
    this.lightboxOpen.set(true);
    document.body.style.overflow = 'hidden';
  }

  ngOnDestroy(): void {
    this.stopSpinHint();
  }

  closeLightbox(): void {
    this.lightboxOpen.set(false);
    this.resetZoom();
    document.body.style.overflow = '';
  }

  resetZoom(): void {
    this.zoom.set(1);
    this.panX.set(0);
    this.panY.set(0);
  }

  /** Clamped so the image cannot be shrunk past its natural size or lost. */
  setZoom(next: number): void {
    const clamped = Math.min(this.maxZoom, Math.max(this.minZoom, next));
    this.zoom.set(clamped);
    if (clamped === 1) {
      this.panX.set(0);
      this.panY.set(0);
    }
  }

  zoomIn(): void { this.setZoom(this.zoom() + 0.5); }
  zoomOut(): void { this.setZoom(this.zoom() - 0.5); }
  toggleZoom(): void { this.setZoom(this.zoom() > 1 ? 1 : 2); }

  step(delta: number): void {
    const images = this.galleryImages();
    if (images.length < 2) return;
    this.activeImg.set((this.activeImg() + delta + images.length) % images.length);
    this.resetZoom();
  }

  onWheel(event: WheelEvent): void {
    if (!this.lightboxOpen()) return;
    event.preventDefault();
    this.setZoom(this.zoom() - Math.sign(event.deltaY) * 0.25);
  }

  startPan(event: PointerEvent): void {
    if (this.zoom() <= 1) return;
    this.dragFrom = { x: event.clientX, y: event.clientY, panX: this.panX(), panY: this.panY() };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  movePan(event: PointerEvent): void {
    if (!this.dragFrom) return;
    this.panX.set(this.dragFrom.panX + (event.clientX - this.dragFrom.x));
    this.panY.set(this.dragFrom.panY + (event.clientY - this.dragFrom.y));
  }

  endPan(): void { this.dragFrom = null; }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!this.lightboxOpen()) return;
    switch (event.key) {
      case 'Escape': this.closeLightbox(); break;
      case 'ArrowRight': this.step(1); break;
      case 'ArrowLeft': this.step(-1); break;
      case '+': case '=': this.zoomIn(); break;
      case '-': this.zoomOut(); break;
      case '0': this.resetZoom(); break;
      default: return;
    }
    event.preventDefault();
  }

  notFound = false;
  carLoaded = false;

  /**
   * Every catalogue source failed and no car resolved.
   *
   * Distinct from `notFound`, which means "this id is unknown but we do have a
   * catalogue". This one means we have nothing at all, and the difference
   * matters to the reader: one is a bad link, the other is the site being
   * unable to reach its data.
   */
  loadFailed = signal(false);

  /**
   * The trim's capacity figure with the right unit behind it.
   *
   * A method rather than a computed(): it takes the row being rendered, and
   * the fuel is read from the trim first because a model can publish petrol
   * and electric trims side by side — the e Vitara does. The car's own fuel is
   * the fallback for a trim that does not state one.
   */
  variantCapacity(v: CarVariant): string {
    return capacityLabel(v.engine_cc, v.fuel_type ?? this.car?.fuel ?? null) ?? '';
  }

  /** The trim's range or economy figure, with a unit when it can be known. */
  variantEconomy(v: CarVariant): string {
    return economyLabel(v.mileage, v.fuel_type ?? this.car?.fuel ?? null) ?? '';
  }

  /**
   * Why the last catalogue request failed — the same string /new-cars prints
   * below its outage panel.
   *
   * A method, not a computed(): it is read from a template that is not itself
   * inside a reactive context, and a computed() over a service signal read
   * this way has been shipped stale twice in this codebase.
   */
  get failureDetail() { return this.carsData.lastFailure(); }

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
    this.sentimentSvc.trackPublic(seller.email, buyerId, 'listing_view', BUYER_TRACKING_CONSENT);
  }

  private async _trackEnquiry(): Promise<void> {
    const buyerId = this.auth.currentUser()?.id;
    if (!buyerId) return;
    const seller = await this.sellersSvc.getForCar(this.car.id).catch(() => null);
    if (!seller?.email) return;
    this.sentimentSvc.trackPublic(seller.email, buyerId, 'enquiry', BUYER_TRACKING_CONSENT);
  }

  constructor(private route: ActivatedRoute, private router: Router, private carsData: CarsDataService, private seo: SeoService, public tco: TcoService, private resaleSvc: ResaleForecastService, public reviewsSvc: ReviewsService, private sellersSvc: SellersService, public auth: AuthService, private sb: SupabaseService, private sentimentSvc: SentimentService, private demandSvc: DemandService, private native: NativeService) {
    // allowSignalWrites, because resolveCar() sets loadFailed and selectedColour
    // — and without it this effect throws NG0600 and the page never renders at
    // all, leaving "Loading car details…" on screen for good.
    //
    // It is a race, not a constant failure, which is why it was not obvious:
    // when the catalogue is already in memory, ngOnInit resolves the car first
    // and this effect returns at the guard above without writing anything. It
    // only writes when the page is opened *while* the catalogue is still
    // loading — a slow connection, a cold start, or a direct link to a car —
    // and then the whole page dies. The deliberate "We could not load this car"
    // state below could never appear, because throwing got there first.
    effect(() => {
      if (this.carLoaded || this.carsData.loading()) return;
      // Ids are opaque strings — coercing to Number turned non-numeric ids
      // (demo cars, any future slug) into NaN, which missed the lookup and
      // silently fell back to the first car in the catalogue.
      const id = this.route.snapshot.paramMap.get('id') ?? '';
      this.resolveCar(id);
    }, { allowSignalWrites: true });

    // Keep the EMI card on the car being priced.
    //
    // Picking a trim or changing the state moves the on-road price, and with it
    // what can be financed. Without this the slider kept a value from the
    // previous trim — above the new maximum, so the thumb sat past the end of
    // its own track and the EMI was for a loan the panel said was too big.
    //
    // Only ever clamps downward, or fills in a slider that has no value yet: a
    // buyer who deliberately dragged to 3L should not have it pushed back up to
    // the full price because they switched state.
    effect(() => {
      const max = this.financeableMax();
      if (!max) return;
      if (!this.loan.amount || this.loan.amount > max) {
        this.loan.amount = max;
        this.calcEmi();
      }
    }, { allowSignalWrites: true });
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    const tab = this.route.snapshot.queryParamMap.get('tab');
    if (tab) this.activeTab.set(tab);
    if (!this.carsData.loading()) {
      this.resolveCar(id);
    }
  }


  /**
   * Ask the catalogue to load again after a failure.
   *
   * The effect in the constructor only re-runs when carsData.loading() flips,
   * so reload() is what makes the retry button do anything — clearing the flag
   * alone would leave the page on a spinner with nothing in flight.
   */
  async retryLoad() {
    this.loadFailed.set(false);
    await this.carsData.reload();
    this.resolveCar(this.route.snapshot.paramMap.get('id') ?? '');
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
    } else {
      // Nothing resolved and the catalogue has finished loading empty — every
      // source failed. Neither branch above fired, carLoaded stayed false, and
      // the page sat on "Loading car details…" for as long as anyone waited.
      //
      // A spinner that never resolves is the worst of the options: it reads as
      // a slow page rather than a broken one, so a buyer waits instead of
      // retrying or leaving. Say so and offer a way out.
      this.loadFailed.set(true);
      return;
    }
    this.loadFailed.set(false);
    if (this.carLoaded) {
      // The listing page caps how many photographs each car carries, so the
      // gallery would otherwise show a sample of this car rather than all of
      // it. Asked for after the car renders: it only ever adds pictures, and
      // waiting for it would hold up the whole page.
      // Traffic on this listing. Only for real listings — a catalogue model has
      // no listing row and would 404. Fired and forgotten: the car page must
      // not wait on analytics, and a failure leaves the card unrendered rather
      // than showing a quiet car.
      if (this.car.isSellerListing) {
        void this.demandSvc.activity(this.car.id).then(a => this.activity.set(a));
      }

      if (!this.car.isSellerListing) {
        void this.loadVariants(this.car.id);
        this.carsData.fullCar(this.car.id).then(fresh => {
          if (!fresh) return;
          const urls = fresh.images ?? [];
          this.car = {
            ...this.car,
            images: urls.length > (this.car.images?.length ?? 0) ? urls : this.car.images,
            spinImages: fresh.spinImages ?? [],
            image: urls.length ? urls[0] : this.car.image,
            // Curated specification wins over the hardcoded map.
            specs: fresh.specs?.length ? fresh.specs : this.car.specs,
            features: fresh.features?.length ? fresh.features : this.car.features,
          };
          if (urls.length) this.activeImg.set(0);
        });
      }
      this.loan.amount = this.financeableMax();
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

  /**
   * Carry the loan being modelled into the application.
   *
   * This button had no handler at all — the primary call to action on the EMI
   * card did nothing when pressed. Prefilling matters as much as navigating:
   * arriving at a blank form after setting three sliders is its own dead end.
   */
  applyForLoan(): void {
    this.router.navigate(['/car-loan'], {
      queryParams: {
        price: this.financeableMax() || undefined,
        amount: this.loan.amount || undefined,
        tenure: this.loan.tenure || undefined,
        car: this.car ? `${this.car.make} ${this.car.model}`.trim() : undefined,
        condition: (this.car as any)?.condition === 'used' ? 'used' : 'new',
      },
    });
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
    // A trim's own price when one is selected. Trims of a model differ by a
    // lakh or more, and the tax band can differ with them, so quoting the
    // model's base figure beside a chosen ZXi+ is quoting the wrong car.
    const trim = this.selectedVariant();
    // With no trim chosen, price the same figure the hero is quoting rather
    // than the catalogue row. Those disagreed: the hero read the published
    // trims and this read car.price, so a Swift showed "from ₹4.26 Lakh" at
    // the top and "Ex-Showroom ₹9.0L" in the panel beside it — a difference
    // of more than double, on the two numbers a buyer compares first.
    const price = Number(trim?.ex_showroom_price) || this.displayPrice()?.amount || this.car.price;
    return computeOnRoadPrice(
      price,
      trim?.fuel_type || this.car.fuel || 'Petrol',
      (this.car as any).body_type ?? (this.car as any).bodyType ?? '',
      this.STATE_REG[this.selectedState()] ?? 0.08,
    );
  });

  /**
   * What the EMI card is allowed to finance.
   *
   * The on-road price, because that is the cheque the buyer actually writes and
   * what a lender lends against. The slider used to cap at `car.price` — the raw
   * catalogue ex-showroom figure — while the panel directly above it quoted an
   * on-road price built from the selected trim. On an S-Presso that read
   * "On-Road Price 4.9L" beside a loan slider that would not go past 3.4L, so
   * the car on the screen could not be modelled at all.
   *
   * Same reasoning as onRoadPrice() itself: the hero, the panel and this card
   * must price one car, not three.
   */
  financeableMax = computed(() => {
    const orp = this.onRoadPrice();
    if (orp?.total) return Math.round(orp.total);
    return this.displayPrice()?.amount ?? this.car?.price ?? 0;
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

  // ── Year-by-year resale forecast ──────────────────────────────────────────
  // How many years the projection covers. 5 matches the 5-year TCO panel below,
  // which is the horizon the rest of this tab already reasons about.
  forecastYears = signal(5);
  // Set once Gemini returns a curve we accepted; until then the local heuristic
  // is displayed, so the table is never empty and never shows a spinner.
  aiForecast = signal<ForecastYear[] | null>(null);
  aiSummary = signal('');
  forecastLoading = signal(false);
  // Distinguishes "not asked yet" from "asked, and the model had nothing" —
  // without it a failed refine looks identical to a page that was never touched.
  forecastTried = signal(false);

  /** The curve on screen: Gemini's if we have one, otherwise the local one. */
  resaleCurve = computed<ForecastYear[]>(() => {
    if (!this.car) return [];
    const ai = this.aiForecast();
    if (ai) return ai;
    const age = Math.max(0, new Date().getFullYear() - this.car.year);
    return this.resaleSvc.local(this.car.price, this.car.fuel || 'Petrol', this.forecastYears(), age);
  });

  /** Total value lost across the whole projection — the headline number. */
  totalDepreciation = computed(() => {
    const curve = this.resaleCurve();
    if (!this.car || !curve.length) return 0;
    return this.car.price - curve[curve.length - 1].value;
  });

  async refineForecast() {
    if (!this.car || this.forecastLoading()) return;
    this.forecastLoading.set(true);
    this.forecastTried.set(true);
    try {
      const result = await this.resaleSvc.refine({
        make: this.car.make || '',
        model: this.car.model || '',
        variant: this.selectedVariant()?.name || this.car.variant || '',
        year: this.car.year,
        fuel: this.car.fuel || 'Petrol',
        transmission: this.car.transmission || '',
        price: this.car.price,
        years: this.forecastYears(),
      });
      if (result?.source === 'ai') {
        this.aiForecast.set(result.forecast);
        this.aiSummary.set(result.summary || '');
      }
    } finally {
      this.forecastLoading.set(false);
    }
  }

  setForecastYears(n: number) {
    if (n === this.forecastYears()) return;
    this.forecastYears.set(n);
    // The AI curve was computed for the old horizon, so it no longer answers
    // the question on screen. Drop back to the local curve rather than padding
    // or truncating someone else's projection.
    this.aiForecast.set(null);
    this.aiSummary.set('');
    this.forecastTried.set(false);
  }

  /** '' until a share happens; 'copied' is the only outcome worth announcing. */
  shareState = signal<'' | 'shared' | 'copied' | 'cancelled'>('');

  /**
   * Share this listing.
   *
   * The OS sheet in the app, the Web Share API in a mobile browser, the
   * clipboard otherwise. Only the clipboard path needs a message: the other two
   * put a sheet on screen, so the user already knows it worked, and a toast on
   * top of that is noise. Dismissing a sheet is a choice, not a failure, and
   * says nothing.
   */
  async shareCar(car: { make: string; model: string; year: number }): Promise<void> {
    const result = await this.native.share({
      title: `${car.make} ${car.model}`,
      text: `${car.make} ${car.model} (${car.year}) on GAADIIQ`,
      url: window.location.href,
    });
    this.shareState.set(result);
    if (result === 'copied') setTimeout(() => this.shareState.set(''), 2500);
  }

  // Bar width for the mini chart, as a share of today's price.
  barWidth(v: number): number {
    if (!this.car?.price) return 0;
    return Math.round((v / this.car.price) * 100);
  }

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
    // Name what is actually missing. The old message listed all three fields
    // whichever one was empty, so someone who had filled in their name and
    // their review — and could not see the rating control, because it was
    // painted white on a white card — was told to fill in a form that looked
    // complete, with no clue which part it meant.
    const missing: string[] = [];
    if (!this.userReview.name) missing.push('your name');
    if (!this.userReview.rating) missing.push('a star rating');
    if (!this.userReview.body) missing.push('your review');
    if (missing.length) {
      const list = missing.length > 1
        ? `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`
        : missing[0];
      this.reviewError.set(`Please add ${list}.`);
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

  /**
   * The "from" price for the similar-cars table.
   *
   * A method, not a computed: `computed()` tracks signal reads, and these rows
   * come from a plain array, so a computed over them would evaluate once and
   * then report a stale answer forever.
   */
  startsAt(car: Car) { return startingPrice(car); }
  stars(n: number) { return Array.from({length: 5}, (_, i) => i < n ? '★' : '☆'); }

  // ── Variants ──────────────────────────────────────────────────────────────
  //
  // These were a hardcoded map covering seven models, so every other model
  // showed no variants at all and no admin action could change it. They are
  // now rows an admin maintains, drafted by research and published after
  // review — a price a buyer budgets against does not belong in a component.
  variants = signal<CarVariant[]>([]);

  /**
   * Which gearbox the buyer is shopping for. '' means all of them.
   *
   * Asked for in UAT: "when a user selects Automatic, show only the variants
   * that support automatic transmission, with their prices and specs".
   */
  gearboxFilter = signal<string>('');

  /**
   * The gearboxes this model is actually sold with.
   *
   * Derived from the trims rather than a fixed list of every transmission on
   * the market. A dropdown offering CVT on a car that has no CVT is a filter
   * whose only outcome is an empty list, and the buyer cannot tell that from
   * a bug.
   */
  gearboxOptions = computed<string[]>(() =>
    [...new Set(
      this.variants().map(v => (v.transmission ?? '').trim()).filter(Boolean)
    )].sort()
  );

  /** The trims on screen, after the gearbox filter. */
  filteredVariants = computed<CarVariant[]>(() => {
    const want = this.gearboxFilter();
    if (!want) return this.variants();
    return this.variants().filter(
      v => (v.transmission ?? '').trim().toLowerCase() === want.toLowerCase()
    );
  });

  /**
   * The published price band, or null when no trim carries a price.
   *
   * Measured over the filtered set, so "starts at" answers the question the
   * buyer is actually asking. Filtering to Automatic and still being quoted
   * the manual's starting price would be worse than showing no band at all.
   */
  variantPriceRange = computed<[number, number] | null>(() => {
    const prices = this.filteredVariants()
      .map(v => Number(v.ex_showroom_price))
      .filter(p => Number.isFinite(p) && p > 0);
    return prices.length ? [Math.min(...prices), Math.max(...prices)] : null;
  });

  setGearbox(value: string) {
    this.gearboxFilter.set(value);
    // A trim hidden by the filter must not stay selected: the on-road price
    // panel would go on quoting a car the buyer can no longer see.
    const stillShown = this.filteredVariants()
      .some(v => v.id === this.selectedVariantId());
    if (!stillShown) this.selectedVariantId.set(null);
  }

  /** The trim the buyer is pricing, or null for the model's base figure. */
  selectedVariantId = signal<string | null>(null);
  selectedVariant = computed(() =>
    this.variants().find(v => v.id === this.selectedVariantId()) ?? null
  );

  /**
   * The headline price, and what it refers to.
   *
   * This page was quoting three different figures at once for the S-Presso:
   * ₹3.5L in the hero, "starts at ₹4.26 Lakh" in the variants tab immediately
   * below it, and ₹4.3L ex-showroom in the On-Road panel beside it. All three
   * were "right" for their own source — the hero read the catalogue row, the
   * other two read the published trims — and a buyer has no way to know that.
   * The one they are most likely to believe is the big one at the top, which
   * was the stale one.
   *
   * The published trims are the source of truth: an admin maintains them, they
   * are what onRoadPrice() already prices, and they are the numbers a buyer
   * budgets against. The hero follows them, and falls back to the catalogue
   * figure only when a model has no priced trims at all.
   */
  displayPrice = computed<{ amount: number; text: string; caption: string } | null>(() => {
    if (!this.car) return null;

    const trim = this.selectedVariant();
    if (trim && Number(trim.ex_showroom_price) > 0) {
      const amount = Number(trim.ex_showroom_price);
      return {
        amount,
        text: this.formatLakh(amount),
        // Naming the trim matters: the same model spans a lakh or more, so a
        // bare figure with no trim beside it is ambiguous by itself.
        caption: `Ex-Showroom · ${trim.name}`,
      };
    }

    const band = this.variantPriceRange();
    if (band) {
      return {
        amount: band[0],
        text: this.formatLakhRange(band[0], band[1]),
        caption: 'Ex-Showroom Price',
      };
    }

    const meta = this.isNewCar ? this.newCarMeta : null;
    if (meta) {
      return {
        amount: meta.priceRange[0],
        text: this.formatLakhRange(meta.priceRange[0], meta.priceRange[1]),
        caption: 'Ex-Showroom Price',
      };
    }

    return {
      amount: this.car.price,
      text: this.formatPrice(this.car.price),
      caption: this.isNewCar ? 'Ex-Showroom Price' : '',
    };
  });

  /**
   * EMI on whatever the hero is quoting.
   *
   * It was computed once from the catalogue price and never moved, so choosing
   * a ZXi+ left "EMI from ₹7,169/mo" underneath it — an instalment for a car
   * the buyer had just navigated away from. For a range, the low end, which is
   * what "EMI from" says.
   */
  /**
   * The "EMI from" line beside the headline price.
   *
   * Reads loanRate()/loanTenure(), the signals, and not loan.rate/loan.tenure,
   * the plain fields they mirror. computed() tracks signal reads only, so with
   * the fields this recomputed only when displayPrice() changed: dragging the
   * tenure slider took the EMI card from ₹15,321 to ₹11,826 while this line
   * stayed at ₹13,315 — two EMIs for the same car, a third of the way apart,
   * one of them silently answering a question the user had stopped asking.
   */
  displayEmi = computed(() => {
    const price = this.displayPrice()?.amount ?? 0;
    if (price <= 0) return 0;
    const r = this.loanRate() / 100 / 12;
    const n = this.loanTenure();
    if (!n) return 0;
    if (r === 0) return Math.round(price / n);
    return Math.round(price * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
  });

  /** Selecting the chosen trim again clears it, back to the model's price. */
  selectVariant(v: CarVariant) {
    if (!v.ex_showroom_price) return;
    this.selectedVariantId.set(this.selectedVariantId() === v.id ? null : v.id);
  }

  private async loadVariants(carId: string) {
    this.variants.set(await this.carsData.variantsFor(carId));
  }

  get isNewCar() { return this.car?.km === 0 && this.car?.year >= 2024; }

  /** Lead-capture modal. A signal because the template gates on it. */
  offersOpen = signal(false);

  openOffers(): void {
    this.offersOpen.set(true);
  }
  /**
   * Brochure specs worth a pill in the Overview.
   *
   * The Overview rendered two facts on a new car — Fuel and Gearbox — because
   * every other pill was conditional on Owners, Colour or Location, and a
   * catalogue model carries none of those. The specs it does carry were only
   * shown on the Specs tab.
   *
   * Fuel and Gearbox are dropped here rather than repeated: they already have
   * their own pills two lines above, and the same fact twice reads as a bug.
   * A method, not a computed(): `car` is a plain field, so a computed() over
   * it would answer once and then go stale.
   */
  overviewSpecs(): { label: string; value: string }[] {
    const shownAlready = ['fuel', 'gearbox', 'transmission'];
    return (this.car?.specs ?? [])
      .filter(sp => sp.value && !shownAlready.includes(sp.label.toLowerCase()))
      .slice(0, 4);
  }

  /** Best available icon for a spec row; `info` when nothing fits. */
  /**
   * A stored feature as a buyer should read it.
   *
   * Some rows hold a Python dict repr — "{'feature': 'Head-Up Display'}" —
   * because the research cleaner used to call str() on whatever the model
   * returned, and objects came back where strings were asked for. The parser
   * is fixed and migration 0039 repairs the stored rows, but that repair only
   * lands when the API deploys, and buyers are reading dict reprs off the page
   * now. This renders them correctly in the meantime, and goes on doing so for
   * any row written before the fix that nobody re-researches.
   *
   * Unwraps exactly what the migration is willing to unwrap and no more: one
   * clear phrase, otherwise the value is shown as it is. Quietly inventing a
   * feature is worse than displaying an ugly one — an ugly one gets reported.
   */
  featureText(value: unknown): string {
    if (typeof value !== 'string') return String(value ?? '');

    const text = value.trim();
    if (!(text.startsWith('{') && text.endsWith('}'))) return text;

    // Single quotes make this a Python repr rather than JSON, so JSON.parse
    // would throw. Matched with a pattern instead of rewritten and parsed,
    // which would break on an apostrophe inside the phrase itself.
    // The backreference matters: the closing quote has to be the same
    // character as the opening one. Without it, "Driver's Seat Memory" is
    // truncated at the apostrophe — which a test caught, and a buyer would
    // have read as "Driver".
    const keyed = text.match(
      /['"](?:feature|name|label|title|value|text)['"]\s*:\s*(['"])(.*?)\1/,
    );
    if (keyed) return keyed[2].trim();

    // No trusted key: unwrap only when the object holds exactly one string.
    const all = [...text.matchAll(/:\s*(['"])(.*?)\1/g)].map(m => m[2]);
    return all.length === 1 ? all[0].trim() : text;
  }

  /** The same unwrapping, for the one-line summary under a trim. */
  featureList(values: string[]): string {
    return values.map(v => this.featureText(v)).filter(Boolean).join(' · ');
  }

  specIcon(label: string): string {
    const l = label.toLowerCase();
    if (l.includes('mileage') || l.includes('range')) return 'gauge';
    if (l.includes('power') || l.includes('torque')) return 'zap';
    if (l.includes('engine')) return 'settings';
    if (l.includes('seat')) return 'user';
    if (l.includes('boot') || l.includes('tank')) return 'fuel';
    return 'info';
  }

  get newCarMeta(): NewCarMeta | null {
    if (!this.isNewCar) return null;
    const key = `${this.car.make} ${this.car.model}`;
    return NEW_CAR_META[key] ?? null;
  }
  // ── Buyer checks: is the price fair, and is the car sound ─────────────────
  //
  // Cached by car id, and methods rather than computed(): `car` is a plain
  // field reassigned in ngOnInit and again when the full record arrives, so a
  // computed() would neither see the update nor recompute. The cache is what
  // keeps them off the change-detection hot path — without it the valuation
  // engine runs on every cycle.
  private _mpCache: { id: string; value: MarketPosition | null } | null = null;
  private _vsCache: { id: string; value: VehicleScore | null } | null = null;

  /**
   * The price gauge, now that the engine behind it has been calibrated.
   *
   * It shipped switched off, because the valuation engine priced every used
   * car on the platform 46–93% below its asking price and the gauge would have
   * labelled essentially all of them "above market" under the heading "Is this
   * a fair price?".
   *
   * That engine has since been rebuilt against three cars actually on sale in
   * New Town — see valuation-engine.ts — and now lands within 8% of dealer
   * asking prices. The asking price of a private listing is compared against
   * the private-sale figure, which is the like-for-like comparison: both are
   * one person selling one car without a warranty behind it.
   */
  private readonly SHOW_PRICE_GAUGE = true;

  /**
   * Traffic on this listing, once the API answers. A signal because it arrives
   * after the page renders — the car must not wait on analytics.
   *
   * Null covers two different things deliberately kept apart: the API being
   * unreachable, and this being a catalogue model with no listing behind it.
   * Neither should render a card claiming a quiet car.
   */
  readonly activity = signal<ListingActivity | null>(null);

  marketPosition(): MarketPosition | null {
    if (!this.SHOW_PRICE_GAUGE) return null;
    if (!this.car || this.isNewCar) return null;
    if (this._mpCache?.id === this.car.id) return this._mpCache.value;

    // The server's own valuation wins when the listing carries one: it saw the
    // real car, this engine only sees make, model and mileage.
    const priced = this.car.aiValuation;
    const band = priced && priced.fairPrice > 0
      ? {
          low: priced.marketMin,
          mid: priced.fairPrice,
          high: priced.marketMax,
          confidence: priced.confidence,
          source: 'listing' as const,
        }
      : bandFromHeuristic({
          make: this.car.make,
          model: this.car.model,
          variant: this.car.variant,
          year: this.car.year,
          km: this.car.km,
          fuel: this.car.fuel,
          transmission: this.car.transmission,
          owners: this.car.owners ?? '1st Owner',
          condition: 'Good',
        });

    // A band the engine could not place is not shown at all. A gauge drawn
    // around a zero estimate would report every car as wildly overpriced.
    const value = band.mid > 0 && this.car.price > 0
      ? marketPosition(this.car.price, band)
      : null;
    this._mpCache = { id: this.car.id, value };
    return value;
  }

  conditionScore(): VehicleScore | null {
    if (!this.car || this.isNewCar) return null;
    if (this._vsCache?.id === this.car.id) return this._vsCache.value;

    const value = vehicleScore({
      year: this.car.year,
      km: this.car.km,
      owners: this.car.owners,
      // Genuinely absent on a catalogue model, and present on a real listing.
      // Left undefined rather than defaulted, so the card can say "not stated"
      // instead of quietly scoring an unstated field as if the seller had
      // answered.
      condition: this.car.condition,
    });
    this._vsCache = { id: this.car.id, value };
    return value;
  }

  formatLakh(p: number) { return `₹${(p / 100000).toFixed(2)} Lakh`; }
  formatLakhRange(min: number, max: number) {
    if (min === max) return `₹${(min / 100000).toFixed(2)} Lakh`;
    return `₹${(min / 100000).toFixed(2)} - ${(max / 100000).toFixed(2)} Lakh`;
  }

  /**
   * Models a buyer would actually cross-shop against this one.
   *
   * Reported against the Fronx (₹6.84L onwards): the table offered the e Vitara
   * at ₹16.0L and the Grand Vitara at ₹16.2L, both drawn with the placeholder
   * image, no mileage and no ratings. Three separate faults, all of which had
   * to be wrong at once to produce that row:
   *
   * 1. NOTHING CHECKED THE ROW WAS SHOWABLE. isShowable() has existed for a
   *    while and is documented as "whether a car belongs on a buyer-facing list
   *    at all" — four other screens call it. This one never did, so catalogue
   *    stubs with no photograph were offered as comparisons. A row with a
   *    placeholder, a dash for mileage and 0 ratings does not read as "we hold
   *    no data"; it reads as a car that is somehow worse than the others.
   *
   * 2. THE BODY-TYPE CLAUSE HAD NO PRICE CEILING. The condition was
   *    `bodyType matches OR price within ₹5L`, so *any* SUV qualified at *any*
   *    price. That is how a ₹16.2L Grand Vitara came to sit beside a ₹6.84L
   *    Fronx. Both clauses now have to hold: the same kind of car, and near
   *    enough in price to be an alternative rather than an aspiration.
   *
   * 3. IT RANKED ON ONE PRICE AND DISPLAYED ANOTHER. Selection and sorting read
   *    `car.price`, the hand-maintained figure on the catalogue row; the table
   *    renders startsAt(), the cheapest published trim. For the Fronx those are
   *    ₹9.3L and ₹6.84L — so the list was ordered by closeness to a number the
   *    page never showed. Both now use startingPrice().
   */
  /*
   * A METHOD, NOT A computed(). It was a computed(), and it reads `this.car` —
   * a plain field assigned from the route subscription, not a signal.
   * computed() tracks signal reads only, so its memo is invalidated by
   * carsData.cars() changing and by nothing else. The catalogue is fetched once,
   * so on a route change from one car to another — same component instance,
   * Angular reuses it across param changes — `this.car` becomes a different car
   * while the memo keeps serving the previous car's rivals.
   *
   * CLAUDE.md names this exact trap and says it has shipped twice. This was the
   * third; it survived because it needs two car pages in one session to see,
   * and every test mounts one.
   */
  similarCars(): Car[] {
    if (!this.car || !this.isNewCar) return [];
    const all = this.carsData.cars();
    const anchor = startingPrice(this.car);
    const seen = new Set<string>();
    const result: Car[] = [];
    const candidates = all
      .filter(c =>
        c.km === 0 && c.year >= 2024 &&
        !(c.make === this.car.make && c.model === this.car.model) &&
        isShowable(c) &&
        c.bodyType === this.car.bodyType &&
        Math.abs(startingPrice(c) - anchor) <= similarPriceWindow(anchor)
      )
      .sort((a, b) =>
        Math.abs(startingPrice(a) - anchor) - Math.abs(startingPrice(b) - anchor),
      );
    for (const c of candidates) {
      const key = `${c.make}||${c.model}`;
      if (!seen.has(key)) { seen.add(key); result.push(c); }
      if (result.length >= 5) break;
    }
    return result;
  }

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
