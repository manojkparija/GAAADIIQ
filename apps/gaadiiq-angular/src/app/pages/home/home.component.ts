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

interface Car {
  id: number; make: string; model: string; year: number; price: number;
  km: number; fuel: string; transmission: string; badge: string; badgeType: string;
  image: string; rating: number; reviews: number; verified: boolean;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, CommonModule, FormsModule, CarCardComponent, IconComponent, ScrollAnimateDirective, CounterDirective],
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

  featuredCars: Car[] = [
    // Maruti Suzuki lineup
    { id:1, make:'Maruti Suzuki', model:'Swift', year:2024, price:749000, km:5000, fuel:'Petrol', transmission:'Manual', badge:'🔥 Bestseller', badgeType:'badge-red', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/159089/swift-exterior-right-front-three-quarter-3.jpeg', rating:4.7, reviews:512, verified:true },
    { id:2, make:'Maruti Suzuki', model:'Baleno', year:2024, price:669000, km:8000, fuel:'Petrol', transmission:'AMT', badge:'⭐ Top Rated', badgeType:'badge-gold', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/54523/baleno-exterior-right-front-three-quarter.jpeg', rating:4.7, reviews:445, verified:true },
    { id:3, make:'Maruti Suzuki', model:'Brezza', year:2024, price:1349000, km:6000, fuel:'Petrol', transmission:'Automatic', badge:'💰 Best Value', badgeType:'badge-gold', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/146811/brezza-exterior-right-front-three-quarter-4.jpeg', rating:4.6, reviews:389, verified:true },
    { id:4, make:'Maruti Suzuki', model:'Grand Vitara', year:2024, price:1799000, km:4000, fuel:'Hybrid', transmission:'Automatic', badge:'⚡ Hybrid', badgeType:'badge-green', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/155843/grand-vitara-exterior-right-front-three-quarter-2.jpeg', rating:4.8, reviews:267, verified:true },
    { id:5, make:'Maruti Suzuki', model:'Fronx', year:2024, price:899000, km:3000, fuel:'Petrol', transmission:'AMT', badge:'🆕 Nearly New', badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/189349/fronx-exterior-right-front-three-quarter.jpeg', rating:4.6, reviews:198, verified:true },
    { id:6, make:'Maruti Suzuki', model:'Jimny', year:2024, price:1299000, km:2000, fuel:'Petrol', transmission:'Manual', badge:'🏔️ Off-Road', badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/130591/jimny-exterior-right-front-three-quarter-2.jpeg', rating:4.9, reviews:143, verified:true },
    // Other popular models
    { id:7, make:'Hyundai', model:'Creta', year:2023, price:1450000, km:12000, fuel:'Petrol', transmission:'Automatic', badge:'🔥 Trending', badgeType:'badge-red', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/106815/creta-exterior-right-front-three-quarter-2.jpeg', rating:4.8, reviews:234, verified:true },
    { id:8, make:'Tata', model:'Nexon EV', year:2024, price:1850000, km:5000, fuel:'Electric', transmission:'Automatic', badge:'⚡ Electric', badgeType:'badge-green', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/166657/nexon-ev-exterior-right-front-three-quarter.jpeg', rating:4.9, reviews:189, verified:true },
    { id:9, make:'Mahindra', model:'XUV700', year:2022, price:2100000, km:22000, fuel:'Diesel', transmission:'Automatic', badge:'👑 Premium', badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/42355/xuv700-exterior-right-front-three-quarter.jpeg', rating:4.7, reviews:156, verified:true },
    { id:10, make:'Kia', model:'Seltos', year:2024, price:1680000, km:3000, fuel:'Petrol', transmission:'DCT', badge:'🆕 Nearly New', badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/115025/seltos-exterior-right-front-three-quarter-3.jpeg', rating:4.8, reviews:201, verified:true },
  ];

  features = [
    { icon:'brain', title:'AI Price Valuation', desc:'Instant fair market valuation — depreciation model + AI analysis when available.', color:'#2F6BFF', route:'/ai-valuation' },
    { icon:'bank', title:'Loan Comparison', desc:'Compare EMI from top banks. Pre-approval in minutes, best rates guaranteed.', color:'#14B8A6', route:'/emi-calculator' },
    { icon:'search', title:'Smart Search', desc:'Natural language search. "Red SUV under 15L near me" — we understand you.', color:'#10B981', route:'/listings' },
    { icon:'bar-chart', title:'Market Intelligence', desc:'Real-time price trends, depreciation charts, and resale value forecasts.', color:'#F59E0B', route:'/compare' },
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
