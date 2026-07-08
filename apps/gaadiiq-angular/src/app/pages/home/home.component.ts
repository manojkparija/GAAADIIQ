import { Component, OnInit, signal, AfterViewInit } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CarCardComponent } from '../../components/car-card/car-card.component';
import { ScrollAnimateDirective } from '../../directives/scroll-animate.directive';
import { CounterDirective } from '../../directives/counter.directive';

interface Car {
  id: number; make: string; model: string; year: number; price: number;
  km: number; fuel: string; transmission: string; badge: string; badgeType: string;
  image: string; rating: number; reviews: number; verified: boolean;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, CommonModule, FormsModule, CarCardComponent, ScrollAnimateDirective, CounterDirective],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit, AfterViewInit {
  searchQuery = signal('');
  activeBodyType = signal('All');
  activeStat = signal(0);

  stats = [
    { value: 0, target: 50000, suffix: '+', label: 'Verified Listings', icon: '🚗' },
    { value: 0, target: 120, suffix: '+', label: 'Cities Covered', icon: '🌆' },
    { value: 0, target: 500, suffix: 'Cr+', label: 'Cars Sold (₹)', icon: '💰' },
    { value: 0, target: 4.8, suffix: '★', label: 'Buyer Rating', icon: '⭐', decimal: true },
  ];

  bodyTypes = ['All','Hatchback','Sedan','SUV','MUV','Electric','Luxury'];
  showAllBrands = false;

  makes = [
    // Popular (shown by default)
    { name: 'Tata',           short: 'TT', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Tata_logo_2020.svg/120px-Tata_logo_2020.svg.png' },
    { name: 'Maruti Suzuki',  short: 'MS', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Suzuki_logo_2.svg/120px-Suzuki_logo_2.svg.png' },
    { name: 'Mahindra',       short: 'MH', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Mahindra_%26_Mahindra_Logo.svg/120px-Mahindra_%26_Mahindra_Logo.svg.png' },
    { name: 'Hyundai',        short: 'HY', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Hyundai_Motor_Company_logo.svg/120px-Hyundai_Motor_Company_logo.svg.png' },
    { name: 'Toyota',         short: 'TY', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9d/Toyota_carlogo.svg/120px-Toyota_carlogo.svg.png' },
    { name: 'Kia',            short: 'KI', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/Kia-logo.svg/120px-Kia-logo.svg.png' },
    { name: 'BMW',            short: 'BMW', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/BMW.svg/120px-BMW.svg.png' },
    { name: 'Skoda',          short: 'SK', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/Skoda_Auto_logo.svg/120px-Skoda_Auto_logo.svg.png' },
    { name: 'MG',             short: 'MG', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/MG_Motor_logo.svg/120px-MG_Motor_logo.svg.png' },
    { name: 'Renault',        short: 'RN', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b7/Renault_2021_Text.svg/120px-Renault_2021_Text.svg.png' },
    { name: 'Volkswagen',     short: 'VW', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Volkswagen_logo_2019.svg/120px-Volkswagen_logo_2019.svg.png' },
    { name: 'Mercedes-Benz',  short: 'MB', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Mercedes-Logo.svg/120px-Mercedes-Logo.svg.png' },
    // Extended (shown when "View More" is clicked)
    { name: 'Honda',          short: 'HO', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/76/Honda_logo.svg/120px-Honda_logo.svg.png' },
    { name: 'Nissan',         short: 'NS', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Nissan_-_logo_%28English%29.svg/120px-Nissan_-_logo_%28English%29.svg.png' },
    { name: 'Land Rover',     short: 'LR', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Land_Rover_logo.svg/120px-Land_Rover_logo.svg.png' },
    { name: 'VinFast',        short: 'VF', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/VinFast_logo.svg/120px-VinFast_logo.svg.png' },
    { name: 'Citroen',        short: 'CT', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Logo_citroen.svg/120px-Logo_citroen.svg.png' },
    { name: 'Jeep',           short: 'JP', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/Jeep_logo.svg/120px-Jeep_logo.svg.png' },
    { name: 'BYD',            short: 'BYD', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/BYD_Auto_logo.svg/120px-BYD_Auto_logo.svg.png' },
    { name: 'Audi',           short: 'AU', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/92/Audi-Logo_2016.svg/120px-Audi-Logo_2016.svg.png' },
    { name: 'Porsche',        short: 'PR', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/81/Porsche_logo.svg/120px-Porsche_logo.svg.png' },
    { name: 'Volvo',          short: 'VO', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Volvo_cars_logo.svg/120px-Volvo_cars_logo.svg.png' },
    { name: 'Lexus',          short: 'LX', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dd/Lexus_logo.svg/120px-Lexus_logo.svg.png' },
    { name: 'Mini',           short: 'MN', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/MINI_logo.svg/120px-MINI_logo.svg.png' },
    { name: 'Lamborghini',    short: 'LB', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Lamborghini_Logo.svg/120px-Lamborghini_Logo.svg.png' },
    { name: 'Force Motors',   short: 'FM', logo: '' },
    { name: 'Jaguar',         short: 'JG', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/24/Jaguar_logo.svg/120px-Jaguar_logo.svg.png' },
    { name: 'Rolls-Royce',    short: 'RR', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Rolls-Royce_Motor_Cars_logo.svg/120px-Rolls-Royce_Motor_Cars_logo.svg.png' },
    { name: 'Ferrari',        short: 'FR', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d1/Ferrari-Logo.svg/120px-Ferrari-Logo.svg.png' },
    { name: 'Tesla',          short: 'TS', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/Tesla_T_symbol.svg/120px-Tesla_T_symbol.svg.png' },
    { name: 'Isuzu',          short: 'IZ', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a0/Isuzu_wordmark.svg/120px-Isuzu_wordmark.svg.png' },
    { name: 'Maserati',       short: 'MA', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Maserati_badge.svg/120px-Maserati_badge.svg.png' },
    { name: 'Aston Martin',   short: 'AM', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Aston_Martin_logo.svg/120px-Aston_Martin_logo.svg.png' },
    { name: 'McLaren',        short: 'MC', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/McLaren_logo_%282020%29.svg/120px-McLaren_logo_%282020%29.svg.png' },
    { name: 'Bentley',        short: 'BT', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/Bentley_logo.svg/120px-Bentley_logo.svg.png' },
    { name: 'Lotus',          short: 'LO', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/51/Lotus_Cars_Logo.svg/120px-Lotus_Cars_Logo.svg.png' },
  ];

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
    { icon:'🤖', title:'AI Price Valuation', desc:'Instant AI-powered fair market valuation — real-time market data, no guesswork.', color:'#6C63FF', route:'/ai-advisor' },
    { icon:'🏦', title:'Loan Comparison', desc:'Compare EMI from top banks. Pre-approval in minutes, best rates guaranteed.', color:'#FF6584', route:'/emi-calculator' },
    { icon:'🔍', title:'Smart Search', desc:'Natural language search. "Red SUV under 15L near me" — we understand you.', color:'#43E97B', route:'/listings' },
    { icon:'📊', title:'Market Intelligence', desc:'Real-time price trends, depreciation charts, and resale value forecasts.', color:'#FFD700', route:'/compare' },
    { icon:'🔔', title:'Price Drop Alerts', desc:'Set your target price. Get notified the moment a listing drops below it.', color:'#00C9FF', route:'/price-alerts' },
    { icon:'🚗', title:'Test Drive Booking', desc:'Book a test drive directly with the seller — from your couch, right now.', color:'#FF8C00', route:'/test-drive' },
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

  setBodyType(type: string) { this.activeBodyType.set(type); }

  onSearch(event: Event) {
    const val = (event.target as HTMLInputElement).value;
    this.searchQuery.set(val);
  }

  formatPrice(p: number): string {
    if (p >= 100000) return `₹${(p/100000).toFixed(1)}L`;
    return `₹${p.toLocaleString()}`;
  }
}
