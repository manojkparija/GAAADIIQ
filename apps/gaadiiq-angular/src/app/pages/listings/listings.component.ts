import { Component, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { CarCardComponent } from '../../components/car-card/car-card.component';
import { CarsDataService, Car } from '../../services/cars-data.service';

@Component({
  selector: 'app-listings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CarCardComponent],
  templateUrl: './listings.component.html',
  styleUrl: './listings.component.scss'
})
export class ListingsComponent implements OnInit {
  constructor(private route: ActivatedRoute, private carsData: CarsDataService) {}

  get loading() { return this.carsData.loading; }

  searchQuery = signal('');
  selectedFuel = signal('All');
  selectedTransmission = signal('All');
  selectedBodyType = signal('All');
  selectedCondition = signal('All');
  selectedSort = signal('Relevance');
  selectedMake = signal('All');
  maxPrice = signal(5000000);
  minYear = signal(2018);
  sidebarOpen = signal(false);

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      if (params['make']) this.selectedMake.set(params['make']);
    });
  }

  fuels = ['All', 'Petrol', 'Diesel', 'Electric', 'CNG', 'Hybrid'];
  transmissions = ['All', 'Manual', 'Automatic', 'CVT', 'DCT', 'AMT'];
  bodyTypes = ['All', 'Hatchback', 'Sedan', 'SUV', 'MUV'];
  conditions = ['All', 'Brand New (0 km)', 'Used (< 50k km)', 'Used (> 50k km)'];
  sorts = ['Relevance', 'Price: Low to High', 'Price: High to Low', 'Newest First', 'Top Rated'];
  years = Array.from({length: 10}, (_, i) => 2024 - i);

  filteredCars = computed(() => {
    let cars = this.carsData.cars().filter(c => {
      const q = this.searchQuery().toLowerCase();
      const matchQ = !q || `${c.make} ${c.model} ${c.city} ${c.bodyType} ${c.year} ${c.fuel}`.toLowerCase().includes(q);
      const matchMake = this.selectedMake() === 'All' || c.make === this.selectedMake();
      const matchFuel = this.selectedFuel() === 'All' || c.fuel === this.selectedFuel();
      const matchTx = this.selectedTransmission() === 'All' || c.transmission.includes(this.selectedTransmission());
      const matchBT = this.selectedBodyType() === 'All' || c.bodyType === this.selectedBodyType();
      const matchPrice = c.price <= this.maxPrice();
      const matchYear = c.year >= this.minYear();
      const cond = this.selectedCondition();
      const matchCond = cond === 'All' ||
        (cond === 'Brand New (0 km)' && c.km === 0) ||
        (cond === 'Used (< 50k km)' && c.km > 0 && c.km <= 50000) ||
        (cond === 'Used (> 50k km)' && c.km > 50000);
      return matchQ && matchMake && matchFuel && matchTx && matchBT && matchPrice && matchYear && matchCond;
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
