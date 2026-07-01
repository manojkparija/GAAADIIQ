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
  selectedSort = signal('Relevance');
  maxPrice = signal(5000000);
  sidebarOpen = signal(false);

  fuels = ['All', 'Petrol', 'Diesel', 'Electric', 'CNG', 'Hybrid'];
  transmissions = ['All', 'Manual', 'Automatic', 'CVT', 'DCT'];
  sorts = ['Relevance', 'Price: Low to High', 'Price: High to Low', 'Newest First', 'Top Rated'];

  allCars: Car[] = [
    // Maruti Suzuki
    { id:1,  make:'Maruti Suzuki', model:'Swift',        year:2024, price:749000,  km:5000,  fuel:'Petrol',   transmission:'Manual',    badge:'🔥 Bestseller',  badgeType:'badge-red',    image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/159089/swift-exterior-right-front-three-quarter-3.jpeg',        rating:4.7, reviews:512, verified:true, city:'Delhi',     bodyType:'Hatchback' },
    { id:2,  make:'Maruti Suzuki', model:'Baleno',       year:2024, price:669000,  km:8000,  fuel:'Petrol',   transmission:'AMT',       badge:'⭐ Top Rated',   badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/54523/baleno-exterior-right-front-three-quarter.jpeg',          rating:4.7, reviews:445, verified:true, city:'Mumbai',    bodyType:'Hatchback' },
    { id:3,  make:'Maruti Suzuki', model:'Alto K10',     year:2023, price:399000,  km:22000, fuel:'Petrol',   transmission:'Manual',    badge:'💰 Budget Pick', badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/146091/alto-k10-exterior-right-front-three-quarter-2.jpeg',     rating:4.4, reviews:678, verified:true, city:'Pune',      bodyType:'Hatchback' },
    { id:4,  make:'Maruti Suzuki', model:'WagonR',       year:2023, price:589000,  km:14000, fuel:'CNG',      transmission:'Manual',    badge:'🌿 CNG Saver',  badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/73611/wagon-r-exterior-right-front-three-quarter-3.jpeg',      rating:4.5, reviews:523, verified:true, city:'Jaipur',    bodyType:'Hatchback' },
    { id:5,  make:'Maruti Suzuki', model:'Dzire',        year:2024, price:699000,  km:9000,  fuel:'Petrol',   transmission:'AMT',       badge:'✅ Certified',   badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/173039/dzire-exterior-right-front-three-quarter-2.jpeg',        rating:4.6, reviews:389, verified:true, city:'Chennai',   bodyType:'Sedan' },
    { id:6,  make:'Maruti Suzuki', model:'Brezza',       year:2024, price:1349000, km:6000,  fuel:'Petrol',   transmission:'Automatic', badge:'💰 Best Value',  badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/146811/brezza-exterior-right-front-three-quarter-4.jpeg',       rating:4.6, reviews:367, verified:true, city:'Bangalore', bodyType:'SUV' },
    { id:7,  make:'Maruti Suzuki', model:'Grand Vitara', year:2024, price:1799000, km:4000,  fuel:'Hybrid',   transmission:'Automatic', badge:'⚡ Hybrid',      badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/155843/grand-vitara-exterior-right-front-three-quarter-2.jpeg', rating:4.8, reviews:267, verified:true, city:'Hyderabad', bodyType:'SUV' },
    { id:8,  make:'Maruti Suzuki', model:'Fronx',        year:2024, price:899000,  km:3000,  fuel:'Petrol',   transmission:'AMT',       badge:'🆕 Nearly New', badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/189349/fronx-exterior-right-front-three-quarter.jpeg',           rating:4.6, reviews:198, verified:true, city:'Ahmedabad', bodyType:'Hatchback' },
    { id:9,  make:'Maruti Suzuki', model:'Jimny',        year:2024, price:1299000, km:2000,  fuel:'Petrol',   transmission:'Manual',    badge:'🏔️ Off-Road',   badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/130591/jimny-exterior-right-front-three-quarter-2.jpeg',        rating:4.9, reviews:143, verified:true, city:'Kolkata',   bodyType:'SUV' },
    { id:10, make:'Maruti Suzuki', model:'Ertiga',       year:2023, price:899000,  km:18000, fuel:'CNG',      transmission:'Manual',    badge:'👨‍👩‍👧 Family Pick', badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/91301/ertiga-exterior-right-front-three-quarter-3.jpeg',       rating:4.6, reviews:312, verified:true, city:'Delhi',     bodyType:'MUV' },
    { id:11, make:'Maruti Suzuki', model:'XL6',          year:2023, price:1199000, km:12000, fuel:'Petrol',   transmission:'Automatic', badge:'👑 Premium MPV', badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/88725/xl6-exterior-right-front-three-quarter-3.jpeg',           rating:4.7, reviews:187, verified:true, city:'Mumbai',    bodyType:'MUV' },
    { id:12, make:'Maruti Suzuki', model:'S-Presso',     year:2023, price:449000,  km:25000, fuel:'CNG',      transmission:'Manual',    badge:'💚 Eco Choice', badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/99491/s-presso-exterior-right-front-three-quarter-3.jpeg',      rating:4.3, reviews:298, verified:true, city:'Pune',      bodyType:'Hatchback' },
    // Other brands
    { id:13, make:'Hyundai',       model:'Creta',        year:2023, price:1450000, km:12000, fuel:'Petrol',   transmission:'Automatic', badge:'🔥 Trending',   badgeType:'badge-red',    image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/106815/creta-exterior-right-front-three-quarter-2.jpeg',        rating:4.8, reviews:234, verified:true, city:'Delhi',     bodyType:'SUV' },
    { id:14, make:'Tata',          model:'Nexon EV',     year:2024, price:1850000, km:5000,  fuel:'Electric', transmission:'Automatic', badge:'⚡ Electric',    badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/166657/nexon-ev-exterior-right-front-three-quarter.jpeg',       rating:4.9, reviews:189, verified:true, city:'Mumbai',    bodyType:'SUV' },
    { id:15, make:'Mahindra',      model:'XUV700',       year:2022, price:2100000, km:22000, fuel:'Diesel',   transmission:'Automatic', badge:'👑 Premium',     badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/42355/xuv700-exterior-right-front-three-quarter.jpeg',           rating:4.7, reviews:156, verified:true, city:'Bangalore', bodyType:'SUV' },
    { id:16, make:'Honda',         model:'City',         year:2023, price:1200000, km:9000,  fuel:'Petrol',   transmission:'CVT',       badge:'✅ Certified',   badgeType:'badge-green',  image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/134297/city-exterior-right-front-three-quarter-4.jpeg',         rating:4.5, reviews:278, verified:true, city:'Chennai',   bodyType:'Sedan' },
    { id:17, make:'Kia',           model:'Seltos',       year:2024, price:1680000, km:3000,  fuel:'Petrol',   transmission:'DCT',       badge:'🆕 Nearly New', badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/115025/seltos-exterior-right-front-three-quarter-3.jpeg',         rating:4.8, reviews:201, verified:true, city:'Hyderabad', bodyType:'SUV' },
    { id:18, make:'Toyota',        model:'Fortuner',     year:2022, price:3500000, km:35000, fuel:'Diesel',   transmission:'Automatic', badge:'💎 Luxury',      badgeType:'badge-gold',   image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/44709/fortuner-exterior-right-front-three-quarter.jpeg',         rating:4.9, reviews:98,  verified:true, city:'Ahmedabad', bodyType:'SUV' },
    { id:19, make:'Hyundai',       model:'i20',          year:2022, price:900000,  km:15000, fuel:'Petrol',   transmission:'Manual',    badge:'🔥 Hot',         badgeType:'badge-red',    image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/39082/i20-exterior-right-front-three-quarter.jpeg',             rating:4.6, reviews:367, verified:true, city:'Kolkata',   bodyType:'Hatchback' },
  ];

  filteredCars = computed(() => {
    let cars = this.allCars.filter(c => {
      const q = this.searchQuery().toLowerCase();
      const matchQ = !q || `${c.make} ${c.model} ${c.city}`.toLowerCase().includes(q);
      const matchFuel = this.selectedFuel() === 'All' || c.fuel === this.selectedFuel();
      const matchTx = this.selectedTransmission() === 'All' || c.transmission === this.selectedTransmission();
      const matchPrice = c.price <= this.maxPrice();
      return matchQ && matchFuel && matchTx && matchPrice;
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
