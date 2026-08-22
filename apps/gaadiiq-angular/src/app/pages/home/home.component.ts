import { Component, OnInit, signal, AfterViewInit } from '@angular/core';
import { RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CarCardComponent } from '../../components/car-card/car-card.component';
import { IconComponent } from '../../components/icon/icon.component';
import { ScrollAnimateDirective } from '../../directives/scroll-animate.directive';
import { CounterDirective } from '../../directives/counter.directive';
import { BrandsService } from '../../services/brands.service';
import { AuthService } from '../../services/auth.service';
import { ImgFallbackDirective } from '../../directives/img-fallback.directive';
import { TranslatePipe } from '../../pipes/translate.pipe';

interface Car {
  id: string; make: string; model: string; year: number; price: number;
  km: number; fuel: string; transmission: string; badge: string; badgeType: string;
  image: string; rating: number; reviews: number; verified: boolean;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, CommonModule, FormsModule, CarCardComponent, IconComponent, ScrollAnimateDirective, CounterDirective, ImgFallbackDirective, TranslatePipe],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit, AfterViewInit {
  searchQuery = signal('');
  activeBodyType = signal('All');

  accountSheetOpen = signal(false);

  constructor(private router: Router, public brandsService: BrandsService, public auth: AuthService) {}

  openAccountSheet() {
    if (this.auth.isLoggedIn()) {
      this.accountSheetOpen.set(true);
    } else {
      this.router.navigate(['/login']);
    }
  }

  async signOut() {
    this.accountSheetOpen.set(false);
    await this.auth.logout();
  }
  activeStat = signal(0);

  stats = [
    { value: 0, target: 50000, suffix: '+', label: 'Verified Listings', icon: '🚗' },
    { value: 0, target: 120, suffix: '+', label: 'Cities Covered', icon: '🌆' },
    { value: 0, target: 500, suffix: 'Cr+', label: 'Cars Sold (₹)', icon: '💰' },
    { value: 0, target: 4.8, suffix: '★', label: 'Buyer Rating', icon: '⭐', decimal: true },
  ];

  bodyTypes = ['All','Hatchback','Sedan','SUV','MUV','Electric','Luxury'];
  showAllBrands = false;

  get makes() { return this.brandsService.brands(); }
  get visibleMakes() { return this.showAllBrands ? this.makes : this.makes.slice(0, 12); }

  // Find Cars section
  findCarsTab = 'Budget';
  findCarsTabs = ['Budget', 'Body Type', 'Fuel Type', 'Transmission', 'Seating Capacity'];

  findCarsOptions: Record<string, { label: string; params: Record<string, string> }[]> = {
    'Budget': [
      { label: 'Under 5 Lakh',  params: { maxPrice: '500000' } },
      { label: 'Under 6 Lakh',  params: { maxPrice: '600000' } },
      { label: 'Under 7 Lakh',  params: { maxPrice: '700000' } },
      { label: 'Under 8 Lakh',  params: { maxPrice: '800000' } },
      { label: 'Under 10 Lakh', params: { maxPrice: '1000000' } },
      { label: 'Under 15 Lakh', params: { maxPrice: '1500000' } },
      { label: 'Under 20 Lakh', params: { maxPrice: '2000000' } },
      { label: 'Under 25 Lakh', params: { maxPrice: '2500000' } },
      { label: 'Under 30 Lakh', params: { maxPrice: '3000000' } },
      { label: 'Luxury Cars',   params: { maxPrice: '20000000', minPrice: '3000000' } },
    ],
    'Body Type': [
      { label: 'Hatchback', params: { bodyType: 'Hatchback' } },
      { label: 'Sedan',     params: { bodyType: 'Sedan' } },
      { label: 'SUV',       params: { bodyType: 'SUV' } },
      { label: 'MUV / MPV', params: { bodyType: 'MUV' } },
      { label: 'Coupe',     params: { bodyType: 'Coupe' } },
      { label: 'Convertible', params: { bodyType: 'Convertible' } },
      { label: 'Pickup Truck', params: { bodyType: 'Pickup' } },
    ],
    'Fuel Type': [
      { label: 'Petrol',   params: { fuel: 'Petrol' } },
      { label: 'Diesel',   params: { fuel: 'Diesel' } },
      { label: 'Electric', params: { fuel: 'Electric' } },
      { label: 'CNG',      params: { fuel: 'CNG' } },
      { label: 'Hybrid',   params: { fuel: 'Hybrid' } },
    ],
    'Transmission': [
      { label: 'Manual',    params: { transmission: 'Manual' } },
      { label: 'Automatic', params: { transmission: 'Automatic' } },
      { label: 'AMT',       params: { transmission: 'AMT' } },
      { label: 'CVT',       params: { transmission: 'CVT' } },
      { label: 'DCT',       params: { transmission: 'DCT' } },
    ],
    'Seating Capacity': [
      { label: '4 Seater', params: { seats: '4' } },
      { label: '5 Seater', params: { seats: '5' } },
      { label: '6 Seater', params: { seats: '6' } },
      { label: '7 Seater', params: { seats: '7' } },
      { label: '8 Seater', params: { seats: '8' } },
    ],
  };

  get activeOptions() { return this.findCarsOptions[this.findCarsTab] ?? []; }

  // featuredCars lived here: ten hardcoded cars with prices, star ratings and
  // review counts ("reviews: 512") that no one ever wrote. It was never
  // rendered — no template referenced it — so it was ten invented listings
  // waiting for someone to wire up a "Featured" strip and ship them as real
  // inventory. Removed rather than left loaded.


  features = [
    { icon:'brain', title:'AI Price Valuation', desc:'Instant fair market valuation — depreciation model + AI analysis when available.', color:'#2F6BFF', route:'/ai-valuation' },
    { icon:'bank', title:'Loan Comparison', desc:'Compare EMI from top banks. Pre-approval in minutes, best rates guaranteed.', color:'#14B8A6', route:'/emi-calculator' },
    { icon:'search', title:'Smart Search', desc:'Natural language search. "Red SUV under 15L near me" — we understand you.', color:'#10B981', route:'/listings' },
    // Routed to the valuation page, which is where depreciation and resale
    // analysis actually lives. There is no separate market-intelligence page;
    // this card used to open the car-comparison page instead, and the copy
    // promised live price trends the app does not yet produce.
    { icon:'bar-chart', title:'Market Intelligence', desc:'Depreciation-based price analysis and resale value estimates for any model.', color:'#F59E0B', route:'/ai-valuation' },
    { icon:'bell', title:'Price Drop Alerts', desc:'Set your target price. Get notified the moment a listing drops below it.', color:'#2F6BFF', route:'/price-alerts' },
    { icon:'car', title:'Test Drive Booking', desc:'Book a test drive directly with the seller — from your couch, right now.', color:'#14B8A6', route:'/test-drive' },
  ];

  testimonials = [
    { name:'Rahul Sharma', city:'Mumbai', text:'Found my dream car in 2 days! The AI valuation saved me ₹80,000. Absolutely incredible platform.', rating:5, avatar:'RS' },
    { name:'Priya Nair', city:'Bangalore', text:'Listed my old Swift and got 12 inquiries in 24 hours. Sold it for better than market price!', rating:5, avatar:'PN' },
    { name:'Amit Patel', city:'Ahmedabad', text:'The loan comparison tool is a game changer. Got 0.5% lower rate than my bank was offering.', rating:5, avatar:'AP' },
  ];

  tickerItems = ['🚗 50,000+ Verified Listings', '⚡ AI-Powered Valuation', '🏦 Best Loan Rates', '✅ Zero Hidden Charges', '🔔 Price Drop Alerts', '🌆 120+ Cities', '🤖 Smart AI Advisor', '💰 500Cr+ Cars Sold'];

  ngOnInit() {
    this.animateStats();
  }

  ngAfterViewInit() {}

  animateStats() {
    this.stats.forEach((stat, i) => {
      const duration = 2000;
      const start = Date.now();
      const tick = () => {
        const elapsed = Date.now() - start;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        stat.value = stat.decimal
          ? Math.round(stat.target * ease * 10) / 10
          : Math.round(stat.target * ease);
        if (progress < 1) requestAnimationFrame(tick);
      };
      setTimeout(() => requestAnimationFrame(tick), i * 200);
    });
  }

  setBodyType(type: string) {
    this.activeBodyType.set(type);
    if (type !== 'All') {
      this.router.navigate(['/listings'], { queryParams: { bodyType: type } });
    }
  }

  onSearch(event: Event) {
    const val = (event.target as HTMLInputElement).value;
    this.searchQuery.set(val);
  }

  doSearch() {
    const params: Record<string, string> = {};
    const q = this.searchQuery().trim();
    const knownTypes = ['hatchback', 'sedan', 'suv', 'muv', 'electric', 'luxury'];
    const qLower = q.toLowerCase();
    const matchedType = knownTypes.find(t => qLower === t || qLower.startsWith(t + ' ') || qLower.endsWith(' ' + t));

    if (matchedType) {
      // Exact body-type keyword → use the precise filter, capitalised
      params['bodyType'] = matchedType.charAt(0).toUpperCase() + matchedType.slice(1);
      const remainder = q.replace(new RegExp(matchedType, 'i'), '').trim();
      if (remainder) params['q'] = remainder;
    } else {
      if (q) params['q'] = q;
    }

    const bt = this.activeBodyType();
    if (bt && bt !== 'All' && !params['bodyType']) params['bodyType'] = bt;
    this.router.navigate(['/listings'], { queryParams: params });
  }

  formatPrice(p: number): string {
    if (p >= 100000) return `₹${(p/100000).toFixed(1)}L`;
    return `₹${p.toLocaleString()}`;
  }
}
