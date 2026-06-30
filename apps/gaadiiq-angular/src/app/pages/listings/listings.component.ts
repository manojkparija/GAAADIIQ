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
    { id:1, make:'Hyundai', model:'Creta', year:2023, price:1450000, km:12000, fuel:'Petrol', transmission:'Automatic', badge:'🔥 Trending', badgeType:'badge-red', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/106815/creta-exterior-right-front-three-quarter-2.jpeg', rating:4.8, reviews:234, verified:true, city:'Delhi', bodyType:'SUV' },
    { id:2, make:'Tata', model:'Nexon EV', year:2024, price:1850000, km:5000, fuel:'Electric', transmission:'Automatic', badge:'⚡ Electric', badgeType:'badge-green', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/166657/nexon-ev-exterior-right-front-three-quarter.jpeg', rating:4.9, reviews:189, verified:true, city:'Mumbai', bodyType:'SUV' },
    { id:3, make:'Maruti', model:'Swift', year:2023, price:750000, km:18000, fuel:'Petrol', transmission:'Manual', badge:'💰 Best Value', badgeType:'badge-gold', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/159089/swift-exterior-right-front-three-quarter-3.jpeg', rating:4.6, reviews:312, verified:true, city:'Pune', bodyType:'Hatchback' },
    { id:4, make:'Mahindra', model:'XUV700', year:2022, price:2100000, km:22000, fuel:'Diesel', transmission:'Automatic', badge:'👑 Premium', badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/42355/xuv700-exterior-right-front-three-quarter.jpeg', rating:4.7, reviews:156, verified:true, city:'Bangalore', bodyType:'SUV' },
    { id:5, make:'Honda', model:'City', year:2023, price:1200000, km:9000, fuel:'Petrol', transmission:'CVT', badge:'✅ Certified', badgeType:'badge-green', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/134297/city-exterior-right-front-three-quarter-4.jpeg', rating:4.5, reviews:278, verified:true, city:'Chennai', bodyType:'Sedan' },
    { id:6, make:'Kia', model:'Seltos', year:2024, price:1680000, km:3000, fuel:'Petrol', transmission:'DCT', badge:'🆕 Nearly New', badgeType:'badge-purple', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/115025/seltos-exterior-right-front-three-quarter-3.jpeg', rating:4.8, reviews:201, verified:true, city:'Hyderabad', bodyType:'SUV' },
    { id:7, make:'Toyota', model:'Fortuner', year:2022, price:3500000, km:35000, fuel:'Diesel', transmission:'Automatic', badge:'💎 Luxury', badgeType:'badge-gold', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/44709/fortuner-exterior-right-front-three-quarter.jpeg', rating:4.9, reviews:98, verified:true, city:'Ahmedabad', bodyType:'SUV' },
    { id:8, make:'Maruti', model:'Baleno', year:2023, price:850000, km:8000, fuel:'Petrol', transmission:'AMT', badge:'⭐ Top Rated', badgeType:'badge-gold', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/54523/baleno-exterior-right-front-three-quarter.jpeg', rating:4.7, reviews:445, verified:true, city:'Jaipur', bodyType:'Hatchback' },
    { id:9, make:'Hyundai', model:'i20', year:2022, price:900000, km:15000, fuel:'Petrol', transmission:'Manual', badge:'🔥 Hot', badgeType:'badge-red', image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/39082/i20-exterior-right-front-three-quarter.jpeg', rating:4.6, reviews:367, verified:true, city:'Kolkata', bodyType:'Hatchback' },
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
