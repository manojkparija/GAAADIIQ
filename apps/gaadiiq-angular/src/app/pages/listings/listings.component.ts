import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CarCardComponent } from '../../components/car-card/car-card.component';

interface Car {
  id: number; make: string; model: string; year: number; price: number;
  km: number; fuel: string; transmission: string; badge: string; badgeType: string;
  image: string; rating: number; reviews: number; verified: boolean; city: string; bodyType: string;
}

@Component({
  selector: 'app-listings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CarCardComponent],
  templateUrl: './listings.component.html',
  styleUrl: './listings.component.scss'
})
export class ListingsComponent {
  searchQuery = signal('');
  selectedFuel = signal('All');
  selectedTransmission = signal('All');
  selectedBodyType = signal('All');
  selectedCondition = signal('All');
  selectedSort = signal('Relevance');
  maxPrice = signal(5000000);
  minYear = signal(2018);
  sidebarOpen = signal(false);

  fuels = ['All', 'Petrol', 'Diesel', 'Electric', 'CNG', 'Hybrid'];
  transmissions = ['All', 'Manual', 'Automatic', 'CVT', 'DCT', 'AMT'];
  bodyTypes = ['All', 'Hatchback', 'Sedan', 'SUV', 'MUV'];
  conditions = ['All', 'Brand New (0 km)', 'Used (< 50k km)', 'High Mileage (> 50k km)'];
  sorts = ['Relevance', 'Price: Low to High', 'Price: High to Low', 'Newest First', 'Top Rated'];
  years = Array.from({length: 10}, (_, i) => 2024 - i);

  allCars: Car[] = [
    // Maruti Suzuki
    { id:1,  make:'Maruti Suzuki', model:'Swift',        year:2024, price:749000,  km:5000,  fuel:'Petrol',   transmission:'Manual',    badge:'🔥 Bestseller',  badgeType:'badge-red',    image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/159089/swift-exterior-right-front-three-quarter-3.jpeg',        rating:4.7, reviews:512, verified:true, city:'Delhi',     bodyType:'Hatchback' },
    { id:2,  make:'Maruti Suzuki', model:'Baleno',       year:2024, price:669000,  km:8000,  fuel:'Petrol',   transmission:'AMT',       badge:'⭐ Top Rated',   badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/54523/baleno-exterior-right-front-three-quarter.jpeg',          rating:4.7, reviews:445, verified:true, city:'Mumbai',    bodyType:'Hatchback' },
    { id:3,  make:'Maruti Suzuki', model:'Alto K10',     year:2023, price:399000,  km:22000, fuel:'Petrol',   transmission:'Manual',    badge:'💰 Budget Pick', badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/146091/alto-k10-exterior-right-front-three-quarter-2.jpeg',     rating:4.4, reviews:678, verified:true, city:'Pune',      bodyType:'Hatchback' },
    { id:4,  make:'Maruti Suzuki', model:'WagonR',       year:2023, price:589000,  km:14000, fuel:'CNG',      transmission:'Manual',    badge:'🌿 CNG Saver',  badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/73611/wagon-r-exterior-right-front-three-quarter-3.jpeg',      rating:4.5, reviews:523, verified:true, city:'Jaipur',    bodyType:'Hatchback' },
    { id:5,  make:'Maruti Suzuki', model:'Dzire',        year:2024, price:699000,  km:9000,  fuel:'Petrol',   transmission:'AMT',       badge:'✅ Certified',   badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/173039/dzire-exterior-right-front-three-quarter-2.jpeg',        rating:4.6, reviews:389, verified:true, city:'Chennai',   bodyType:'Sedan' },
    { id:6,  make:'Maruti Suzuki', model:'Brezza',       year:2024, price:1349000, km:6000,  fuel:'Petrol',   transmission:'Automatic', badge:'💰 Best Value',  badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/146811/brezza-exterior-right-front-three-quarter-4.jpeg',       rating:4.6, reviews:367, verified:true, city:'Bangalore', bodyType:'SUV' },
    { id:7,  make:'Maruti Suzuki', model:'Grand Vitara', year:2024, price:1799000, km:4000,  fuel:'Hybrid',   transmission:'Automatic', badge:'⚡ Hybrid',      badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/155843/grand-vitara-exterior-right-front-three-quarter-2.jpeg', rating:4.8, reviews:267, verified:true, city:'Hyderabad', bodyType:'SUV' },
    { id:8,  make:'Maruti Suzuki', model:'Fronx',        year:2024, price:899000,  km:0,     fuel:'Petrol',   transmission:'AMT',       badge:'🆕 Brand New',  badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/189349/fronx-exterior-right-front-three-quarter.jpeg',           rating:4.6, reviews:198, verified:true, city:'Ahmedabad', bodyType:'Hatchback' },
    { id:9,  make:'Maruti Suzuki', model:'Jimny',        year:2024, price:1299000, km:0,     fuel:'Petrol',   transmission:'Manual',    badge:'🆕 Brand New',  badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/130591/jimny-exterior-right-front-three-quarter-2.jpeg',        rating:4.9, reviews:143, verified:true, city:'Kolkata',   bodyType:'SUV' },
    { id:10, make:'Maruti Suzuki', model:'Ertiga',       year:2023, price:899000,  km:18000, fuel:'CNG',      transmission:'Manual',    badge:'👨‍👩‍👧 Family Pick', badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/91301/ertiga-exterior-right-front-three-quarter-3.jpeg',       rating:4.6, reviews:312, verified:true, city:'Delhi',     bodyType:'MUV' },
    { id:11, make:'Maruti Suzuki', model:'XL6',          year:2023, price:1199000, km:12000, fuel:'Petrol',   transmission:'Automatic', badge:'👑 Premium MPV', badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/88725/xl6-exterior-right-front-three-quarter-3.jpeg',           rating:4.7, reviews:187, verified:true, city:'Mumbai',    bodyType:'MUV' },
    { id:12, make:'Maruti Suzuki', model:'S-Presso',     year:2023, price:449000,  km:25000, fuel:'CNG',      transmission:'Manual',    badge:'💚 Eco Choice', badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/99491/s-presso-exterior-right-front-three-quarter-3.jpeg',      rating:4.3, reviews:298, verified:true, city:'Pune',      bodyType:'Hatchback' },
    // Hyundai
    { id:13, make:'Hyundai', model:'Creta',        year:2024, price:1450000, km:8000,  fuel:'Petrol',   transmission:'Automatic', badge:'🔥 Trending',    badgeType:'badge-red',    image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/106815/creta-exterior-right-front-three-quarter-2.jpeg',          rating:4.8, reviews:234, verified:true, city:'Delhi',     bodyType:'SUV' },
    { id:14, make:'Hyundai', model:'Venue',        year:2024, price:899000,  km:10000, fuel:'Petrol',   transmission:'DCT',       badge:'⭐ Top Rated',    badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/48890/venue-exterior-right-front-three-quarter-2.jpeg',           rating:4.6, reviews:312, verified:true, city:'Mumbai',    bodyType:'SUV' },
    { id:15, make:'Hyundai', model:'i20',          year:2023, price:749000,  km:15000, fuel:'Petrol',   transmission:'Manual',    badge:'🔥 Hot',          badgeType:'badge-red',    image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/39082/i20-exterior-right-front-three-quarter.jpeg',             rating:4.6, reviews:367, verified:true, city:'Kolkata',   bodyType:'Hatchback' },
    { id:16, make:'Hyundai', model:'Verna',        year:2024, price:1099000, km:6000,  fuel:'Petrol',   transmission:'CVT',       badge:'✅ Certified',    badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/163078/verna-exterior-right-front-three-quarter-3.jpeg',          rating:4.7, reviews:189, verified:true, city:'Chennai',   bodyType:'Sedan' },
    { id:17, make:'Hyundai', model:'Alcazar',      year:2023, price:1699000, km:18000, fuel:'Petrol',   transmission:'Automatic', badge:'👑 Premium',      badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/131517/alcazar-exterior-right-front-three-quarter-3.jpeg',          rating:4.7, reviews:143, verified:true, city:'Bangalore', bodyType:'SUV' },
    { id:18, make:'Hyundai', model:'Exter',        year:2024, price:699000,  km:0,     fuel:'Petrol',   transmission:'AMT',       badge:'🆕 Brand New',    badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/192315/exter-exterior-right-front-three-quarter-2.jpeg',           rating:4.5, reviews:156, verified:true, city:'Hyderabad', bodyType:'Hatchback' },
    { id:19, make:'Hyundai', model:'Tucson',       year:2023, price:2899000, km:12000, fuel:'Petrol',   transmission:'Automatic', badge:'💎 Luxury',       badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/48457/tucson-exterior-right-front-three-quarter-3.jpeg',           rating:4.8, reviews:98,  verified:true, city:'Delhi',     bodyType:'SUV' },
    { id:20, make:'Hyundai', model:'Aura',         year:2023, price:749000,  km:20000, fuel:'CNG',      transmission:'Manual',    badge:'🌿 CNG Saver',    badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/128153/aura-exterior-right-front-three-quarter-2.jpeg',            rating:4.4, reviews:267, verified:true, city:'Jaipur',    bodyType:'Sedan' },
    // Tata Motors
    { id:21, make:'Tata', model:'Nexon EV',        year:2024, price:1499000, km:5000,  fuel:'Electric', transmission:'Automatic', badge:'⚡ Electric',     badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/166657/nexon-ev-exterior-right-front-three-quarter.jpeg',        rating:4.9, reviews:189, verified:true, city:'Mumbai',    bodyType:'SUV' },
    { id:22, make:'Tata', model:'Nexon',           year:2024, price:899000,  km:9000,  fuel:'Petrol',   transmission:'AMT',       badge:'🔥 Bestseller',   badgeType:'badge-red',    image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/156909/nexon-exterior-right-front-three-quarter-4.jpeg',          rating:4.7, reviews:412, verified:true, city:'Pune',      bodyType:'SUV' },
    { id:23, make:'Tata', model:'Punch',           year:2024, price:649000,  km:7000,  fuel:'Petrol',   transmission:'AMT',       badge:'💰 Best Value',   badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/138491/punch-exterior-right-front-three-quarter-3.jpeg',           rating:4.6, reviews:356, verified:true, city:'Delhi',     bodyType:'Hatchback' },
    { id:24, make:'Tata', model:'Harrier',         year:2023, price:1999000, km:15000, fuel:'Diesel',   transmission:'Automatic', badge:'👑 Premium',      badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/48492/harrier-exterior-right-front-three-quarter-4.jpeg',           rating:4.7, reviews:178, verified:true, city:'Bangalore', bodyType:'SUV' },
    { id:25, make:'Tata', model:'Safari',          year:2024, price:1649000, km:8000,  fuel:'Diesel',   transmission:'Automatic', badge:'🏔️ Adventure',    badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/137426/safari-exterior-right-front-three-quarter-3.jpeg',           rating:4.8, reviews:201, verified:true, city:'Ahmedabad', bodyType:'SUV' },
    { id:26, make:'Tata', model:'Altroz',          year:2023, price:699000,  km:13000, fuel:'Petrol',   transmission:'Manual',    badge:'⭐ Top Rated',    badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/97530/altroz-exterior-right-front-three-quarter-3.jpeg',           rating:4.6, reviews:289, verified:true, city:'Chennai',   bodyType:'Hatchback' },
    { id:27, make:'Tata', model:'Tiago',           year:2023, price:549000,  km:19000, fuel:'Petrol',   transmission:'Manual',    badge:'💰 Budget Pick',  badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/48718/tiago-exterior-right-front-three-quarter-5.jpeg',           rating:4.4, reviews:445, verified:true, city:'Kolkata',   bodyType:'Hatchback' },
    { id:28, make:'Tata', model:'Tigor EV',        year:2024, price:1199000, km:0,     fuel:'Electric', transmission:'Automatic', badge:'🆕 Brand New',    badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/133490/tigor-ev-exterior-right-front-three-quarter-2.jpeg',        rating:4.5, reviews:134, verified:true, city:'Hyderabad', bodyType:'Sedan' },
    // Mahindra
    { id:29, make:'Mahindra', model:'XUV700',      year:2023, price:1499000, km:14000, fuel:'Petrol',   transmission:'Automatic', badge:'🔥 Trending',     badgeType:'badge-red',    image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/42355/xuv700-exterior-right-front-three-quarter.jpeg',            rating:4.8, reviews:234, verified:true, city:'Delhi',     bodyType:'SUV' },
    { id:30, make:'Mahindra', model:'Scorpio N',   year:2023, price:1399000, km:18000, fuel:'Diesel',   transmission:'Manual',    badge:'💪 Beast Mode',   badgeType:'badge-red',    image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/154491/scorpio-n-exterior-right-front-three-quarter-3.jpeg',       rating:4.7, reviews:312, verified:true, city:'Mumbai',    bodyType:'SUV' },
    { id:31, make:'Mahindra', model:'Thar',        year:2024, price:1499000, km:6000,  fuel:'Diesel',   transmission:'Manual',    badge:'🏔️ Off-Road',    badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/126682/thar-exterior-right-front-three-quarter-3.jpeg',            rating:4.9, reviews:267, verified:true, city:'Bangalore', bodyType:'SUV' },
    { id:32, make:'Mahindra', model:'XUV300',      year:2023, price:899000,  km:22000, fuel:'Petrol',   transmission:'AMT',       badge:'✅ Certified',    badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/63177/xuv300-exterior-right-front-three-quarter-3.jpeg',           rating:4.5, reviews:198, verified:true, city:'Pune',      bodyType:'SUV' },
    { id:33, make:'Mahindra', model:'XUV400 EV',   year:2024, price:1599000, km:0,     fuel:'Electric', transmission:'Automatic', badge:'🆕 Brand New',    badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/178825/xuv400-ev-exterior-right-front-three-quarter-2.jpeg',       rating:4.6, reviews:112, verified:true, city:'Chennai',   bodyType:'SUV' },
    { id:34, make:'Mahindra', model:'Bolero',      year:2022, price:999000,  km:35000, fuel:'Diesel',   transmission:'Manual',    badge:'💰 Workhorse',    badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/52065/bolero-exterior-right-front-three-quarter.jpeg',             rating:4.3, reviews:389, verified:true, city:'Ahmedabad', bodyType:'MUV' },
    { id:35, make:'Mahindra', model:'Marazzo',     year:2022, price:1299000, km:28000, fuel:'Diesel',   transmission:'Manual',    badge:'👨‍👩‍👧 Family MPV', badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/58347/marazzo-exterior-right-front-three-quarter-3.jpeg',          rating:4.5, reviews:143, verified:true, city:'Jaipur',    bodyType:'MUV' },
    // Honda
    { id:36, make:'Honda', model:'City',           year:2024, price:1199000, km:6000,  fuel:'Petrol',   transmission:'CVT',       badge:'✅ Certified',    badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/134297/city-exterior-right-front-three-quarter-4.jpeg',           rating:4.5, reviews:278, verified:true, city:'Chennai',   bodyType:'Sedan' },
    { id:37, make:'Honda', model:'Elevate',        year:2024, price:1199000, km:0,     fuel:'Petrol',   transmission:'CVT',       badge:'🆕 Brand New',    badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/192337/elevate-exterior-right-front-three-quarter-2.jpeg',          rating:4.6, reviews:167, verified:true, city:'Mumbai',    bodyType:'SUV' },
    { id:38, make:'Honda', model:'Amaze',          year:2024, price:749000,  km:11000, fuel:'Petrol',   transmission:'CVT',       badge:'💰 Best Value',   badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/130277/amaze-exterior-right-front-three-quarter-3.jpeg',           rating:4.4, reviews:312, verified:true, city:'Delhi',     bodyType:'Sedan' },
    { id:39, make:'Honda', model:'WR-V',           year:2022, price:999000,  km:28000, fuel:'Petrol',   transmission:'Manual',    badge:'💰 Budget SUV',   badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/56906/wr-v-exterior-right-front-three-quarter-2.jpeg',            rating:4.3, reviews:198, verified:true, city:'Bangalore', bodyType:'SUV' },
    // Toyota
    { id:40, make:'Toyota', model:'Fortuner',      year:2023, price:3499000, km:22000, fuel:'Diesel',   transmission:'Automatic', badge:'💎 Luxury',       badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/44709/fortuner-exterior-right-front-three-quarter.jpeg',          rating:4.9, reviews:98,  verified:true, city:'Ahmedabad', bodyType:'SUV' },
    { id:41, make:'Toyota', model:'Innova Crysta', year:2023, price:2099000, km:30000, fuel:'Diesel',   transmission:'Manual',    badge:'👨‍👩‍👧 Family Pick', badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/137566/innova-crysta-exterior-right-front-three-quarter-4.jpeg', rating:4.8, reviews:312, verified:true, city:'Mumbai',    bodyType:'MUV' },
    { id:42, make:'Toyota', model:'Urban Cruiser Hyryder', year:2024, price:1099000, km:5000, fuel:'Hybrid', transmission:'Automatic', badge:'⚡ Hybrid', badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/161933/urban-cruiser-hyryder-exterior-right-front-three-quarter-3.jpeg', rating:4.7, reviews:189, verified:true, city:'Delhi',     bodyType:'SUV' },
    { id:43, make:'Toyota', model:'Glanza',        year:2024, price:699000,  km:8000,  fuel:'Petrol',   transmission:'AMT',       badge:'⭐ Top Rated',    badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/143826/glanza-exterior-right-front-three-quarter-3.jpeg',          rating:4.6, reviews:234, verified:true, city:'Bangalore', bodyType:'Hatchback' },
    { id:44, make:'Toyota', model:'Camry',         year:2023, price:4599000, km:15000, fuel:'Hybrid',   transmission:'Automatic', badge:'👑 Executive',    badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/68956/camry-exterior-right-front-three-quarter-3.jpeg',             rating:4.9, reviews:67,  verified:true, city:'Chennai',   bodyType:'Sedan' },
    { id:45, make:'Toyota', model:'Hilux',         year:2023, price:3799000, km:18000, fuel:'Diesel',   transmission:'Automatic', badge:'🏔️ Off-Road',    badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/152571/hilux-exterior-right-front-three-quarter-2.jpeg',           rating:4.8, reviews:89,  verified:true, city:'Hyderabad', bodyType:'SUV' },
    // Kia
    { id:46, make:'Kia', model:'Seltos',           year:2024, price:1099000, km:0,     fuel:'Petrol',   transmission:'DCT',       badge:'🆕 Brand New',    badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/115025/seltos-exterior-right-front-three-quarter-3.jpeg',          rating:4.8, reviews:201, verified:true, city:'Hyderabad', bodyType:'SUV' },
    { id:47, make:'Kia', model:'Sonet',            year:2024, price:849000,  km:6000,  fuel:'Petrol',   transmission:'DCT',       badge:'🔥 Trending',     badgeType:'badge-red',    image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/128955/sonet-exterior-right-front-three-quarter-3.jpeg',           rating:4.7, reviews:267, verified:true, city:'Delhi',     bodyType:'SUV' },
    { id:48, make:'Kia', model:'Carens',           year:2023, price:1099000, km:12000, fuel:'Diesel',   transmission:'Automatic', badge:'👨‍👩‍👧 Family MPV', badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/153381/carens-exterior-right-front-three-quarter-3.jpeg',          rating:4.6, reviews:198, verified:true, city:'Mumbai',    bodyType:'MUV' },
    { id:49, make:'Kia', model:'EV6',              year:2023, price:6099000, km:8000,  fuel:'Electric', transmission:'Automatic', badge:'⚡ Premium EV',   badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/151239/ev6-exterior-right-front-three-quarter-3.jpeg',            rating:4.9, reviews:78,  verified:true, city:'Bangalore', bodyType:'SUV' },
    // MG Motor
    { id:50, make:'MG Motor', model:'Hector',      year:2024, price:1499000, km:9000,  fuel:'Petrol',   transmission:'Automatic', badge:'🔥 Popular',      badgeType:'badge-red',    image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/77238/hector-exterior-right-front-three-quarter-4.jpeg',           rating:4.6, reviews:234, verified:true, city:'Delhi',     bodyType:'SUV' },
    { id:51, make:'MG Motor', model:'Astor',       year:2023, price:999000,  km:14000, fuel:'Petrol',   transmission:'CVT',       badge:'🤖 AI Features',  badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/143831/astor-exterior-right-front-three-quarter-3.jpeg',           rating:4.5, reviews:167, verified:true, city:'Mumbai',    bodyType:'SUV' },
    { id:52, make:'MG Motor', model:'ZS EV',       year:2024, price:2299000, km:6000,  fuel:'Electric', transmission:'Automatic', badge:'⚡ Electric',     badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/87201/zs-ev-exterior-right-front-three-quarter-3.jpeg',           rating:4.7, reviews:143, verified:true, city:'Bangalore', bodyType:'SUV' },
    { id:53, make:'MG Motor', model:'Gloster',     year:2023, price:3899000, km:20000, fuel:'Diesel',   transmission:'Automatic', badge:'👑 Flagship',      badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/131530/gloster-exterior-right-front-three-quarter-3.jpeg',          rating:4.8, reviews:89,  verified:true, city:'Chennai',   bodyType:'SUV' },
    { id:54, make:'MG Motor', model:'Comet EV',    year:2024, price:699000,  km:0,     fuel:'Electric', transmission:'Automatic', badge:'🆕 Brand New',    badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/191285/comet-ev-exterior-right-front-three-quarter-2.jpeg',        rating:4.3, reviews:112, verified:true, city:'Hyderabad', bodyType:'Hatchback' },
  ];

  filteredCars = computed(() => {
    let cars = this.allCars.filter(c => {
      const q = this.searchQuery().toLowerCase();
      const matchQ = !q || `${c.make} ${c.model} ${c.city} ${c.bodyType} ${c.year} ${c.fuel}`.toLowerCase().includes(q);
      const matchFuel = this.selectedFuel() === 'All' || c.fuel === this.selectedFuel();
      const matchTx = this.selectedTransmission() === 'All' || c.transmission.includes(this.selectedTransmission());
      const matchBT = this.selectedBodyType() === 'All' || c.bodyType === this.selectedBodyType();
      const matchPrice = c.price <= this.maxPrice();
      const matchYear = c.year >= this.minYear();
      const cond = this.selectedCondition();
      const matchCond = cond === 'All' ||
        (cond === 'Brand New (0 km)' && c.km === 0) ||
        (cond === 'Used (< 50k km)' && c.km > 0 && c.km <= 50000) ||
        (cond === 'High Mileage (> 50k km)' && c.km > 50000);
      return matchQ && matchFuel && matchTx && matchBT && matchPrice && matchYear && matchCond;
    });

    const sort = this.selectedSort();
    if (sort === 'Price: Low to High') cars = [...cars].sort((a,b) => a.price - b.price);
    else if (sort === 'Price: High to Low') cars = [...cars].sort((a,b) => b.price - a.price);
    else if (sort === 'Newest First') cars = [...cars].sort((a,b) => b.year - a.year);
    else if (sort === 'Top Rated') cars = [...cars].sort((a,b) => b.rating - a.rating);
    return cars;
  });

  formatPrice(p: number) { return p >= 100000 ? `₹${(p/100000).toFixed(0)}L` : `₹${p}`; }
}
