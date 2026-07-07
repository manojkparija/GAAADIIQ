import { Component, signal, computed, OnInit, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CarsDataService, Car } from '../../services/cars-data.service';
import { TcoService } from '../../services/tco.service';
import { ReviewsService, CarReview } from '../../services/reviews.service';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-car-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './car-detail.component.html',
  styleUrl: './car-detail.component.scss'
})
export class CarDetailComponent implements OnInit {
  activeTab = signal('overview');
  liked = signal(false);
  loan = { amount: 0, rate: 8.5, tenure: 60, emi: 0 };
  car!: Car;
  activeImg = signal(0);
  notFound = false;
  carLoaded = false;

  // On-road price
  selectedState = signal('Maharashtra');
  states = ['Maharashtra','Delhi','Karnataka','Tamil Nadu','Telangana','Gujarat','Rajasthan','West Bengal','Uttar Pradesh','Kerala'];

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

  constructor(private route: ActivatedRoute, private carsData: CarsDataService, private seo: SeoService, public tco: TcoService, public reviewsSvc: ReviewsService) {
    effect(() => {
      if (this.carLoaded || this.carsData.loading()) return;
      const id = Number(this.route.snapshot.paramMap.get('id'));
      this.resolveCar(id);
    });
  }

  ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!this.carsData.loading()) {
      this.resolveCar(id);
    }
  }

  private resolveCar(id: number) {
    if (this.carLoaded) return;
    const found = this.carsData.getById(id);
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
      this.loadReviews();
      this.seo.setCarDetail(this.car.make, this.car.model, this.car.year, this.car.price, this.car.city || 'India');
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
  }

  // On-road price calculation
  onRoadPrice = computed(() => {
    if (!this.car) return null;
    const base = this.car.price;
    const gst = this.car.fuel === 'Electric' ? base * 0.05 : base < 1000000 ? base * 0.28 : base * 0.28;
    const cess = base < 1000000 ? base * 0.01 : base * 0.17;
    const registration = base * 0.09;
    const insurance = Math.round(base * 0.035);
    const handling = 10000;
    const total = Math.round(base + gst + cess + registration + insurance + handling);
    return { base, gst: Math.round(gst), cess: Math.round(cess), registration: Math.round(registration), insurance, handling, total };
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

  formatPrice(p: number) { return p >= 100000 ? `₹${(p / 100000).toFixed(1)}L` : `₹${p.toLocaleString()}`; }
  stars(n: number) { return Array.from({length: 5}, (_, i) => i < n ? '★' : '☆'); }
}
