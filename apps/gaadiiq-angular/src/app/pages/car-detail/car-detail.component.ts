import { Component, signal, computed, OnInit, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CarsDataService, Car } from '../../services/cars-data.service';
import { SeoService } from '../../services/seo.service';

interface Review {
  name: string; rating: number; city: string; date: string;
  title: string; body: string; avatar: string; likes: number;
}

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

  // Reviews
  reviews: Review[] = [
    { name:'Rajesh Kumar', rating:5, city:'Mumbai', date:'15 Jun 2025', title:'Excellent value for money!', body:'Been using it for 6 months. Fuel efficiency is outstanding and the infotainment is top class. Service experience at Maruti is seamless.', avatar:'RK', likes:24 },
    { name:'Priya Singh', rating:4, city:'Delhi', date:'02 May 2025', title:'Great car, minor niggles', body:'Loved the build quality and features. Sunroof is a delight. Only gripe is the rear seat space could be slightly better for tall passengers.', avatar:'PS', likes:18 },
    { name:'Amit Verma', rating:5, city:'Bangalore', date:'10 Apr 2025', title:'AI valuation saved me ₹60,000', body:'Gaadiiq AI told me the fair price before I visited the dealer. Negotiated confidently. Absolutely recommend this platform before buying any car.', avatar:'AV', likes:41 },
  ];
  userReview = { rating: 0, title: '', body: '', name: '', city: '' };
  showReviewForm = signal(false);
  reviewSubmitted = signal(false);
  hoverRating = signal(0);

  constructor(private route: ActivatedRoute, private carsData: CarsDataService, private seo: SeoService) {
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

  submitReview() {
    if (!this.userReview.rating || !this.userReview.body || !this.userReview.name) return;
    this.reviews.unshift({
      name: this.userReview.name, rating: this.userReview.rating,
      city: this.userReview.city || 'India', date: new Date().toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'}),
      title: this.userReview.title || 'My Review', body: this.userReview.body,
      avatar: this.userReview.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2),
      likes: 0
    });
    this.reviewSubmitted.set(true);
    this.showReviewForm.set(false);
  }

  avgRating = computed(() => {
    const all = this.reviews.map(r => r.rating);
    return (all.reduce((a, b) => a + b, 0) / all.length).toFixed(1);
  });

  formatPrice(p: number) { return p >= 100000 ? `₹${(p / 100000).toFixed(1)}L` : `₹${p.toLocaleString()}`; }
  stars(n: number) { return Array.from({length: 5}, (_, i) => i < n ? '★' : '☆'); }
}
