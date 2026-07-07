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

  searchQuery        = signal('');
  selectedFuel       = signal('All');
  selectedTransmission = signal('All');
  selectedBodyType   = signal('All');
  selectedSort       = signal('Relevance');
  selectedMake       = signal('All');
  maxPrice           = signal(20000000);
  minYear            = signal(2018);
  sidebarOpen        = signal(false);

  // Top-level car type: 'All' | 'New' | 'Used'
  carType = signal<'All' | 'New' | 'Used'>('All');

  // Used-only sub-filter: 'All' | '< 50k km' | '> 50k km'
  usedKmRange = signal<'All' | '< 50k km' | '> 50k km'>('All');

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      this.selectedMake.set(params['make'] || 'All');
      this.selectedFuel.set(params['fuel'] || 'All');
      this.selectedBodyType.set(params['bodyType'] || 'All');
      if (params['carType']) this.carType.set(params['carType'] as any);
    });
  }

  fuels         = ['All', 'Petrol', 'Diesel', 'Electric', 'CNG', 'Hybrid'];
  transmissions = ['All', 'Manual', 'Automatic', 'CVT', 'DCT', 'AMT'];
  bodyTypes     = ['All', 'Hatchback', 'Sedan', 'SUV', 'MUV'];
  sorts         = ['Relevance', 'Price: Low to High', 'Price: High to Low', 'Newest First', 'Top Rated'];

  setCarType(t: 'All' | 'New' | 'Used') {
    this.carType.set(t);
    this.usedKmRange.set('All');
  }

  filteredCars = computed(() => {
    let cars = this.carsData.cars().filter(c => {
      const q = this.searchQuery().toLowerCase();
      const matchQ  = !q || `${c.make} ${c.model} ${c.city} ${c.bodyType} ${c.year} ${c.fuel}`.toLowerCase().includes(q);
      const matchMake = this.selectedMake() === 'All' || c.make === this.selectedMake();
      const matchFuel = this.selectedFuel() === 'All' || c.fuel === this.selectedFuel();
      const matchTx   = this.selectedTransmission() === 'All' || c.transmission.includes(this.selectedTransmission());
      const matchBT   = this.selectedBodyType() === 'All' || c.bodyType === this.selectedBodyType();
      const matchPrice = c.price <= this.maxPrice();
      const matchYear  = c.year >= this.minYear();

      // Top-level New / Used split
      const type = this.carType();
      const matchType = type === 'All' ? true :
        type === 'New'  ? c.km === 0 :
        /* Used */ c.km > 0;

      // Used km sub-range
      const range = this.usedKmRange();
      const matchRange = type !== 'Used' || range === 'All' ? true :
        range === '< 50k km' ? c.km <= 50000 : c.km > 50000;

      return matchQ && matchMake && matchFuel && matchTx && matchBT && matchPrice && matchYear && matchType && matchRange;
    });

    const sort = this.selectedSort();
    if (sort === 'Price: Low to High') cars = [...cars].sort((a,b) => a.price - b.price);
    else if (sort === 'Price: High to Low') cars = [...cars].sort((a,b) => b.price - a.price);
    else if (sort === 'Newest First') cars = [...cars].sort((a,b) => b.year - a.year);
    else if (sort === 'Top Rated') cars = [...cars].sort((a,b) => b.rating - a.rating);
    return cars;
  });

  newCount  = computed(() => this.carsData.cars().filter(c => c.km === 0).length);
  usedCount = computed(() => this.carsData.cars().filter(c => c.km > 0).length);

  formatPrice(p: number) {
    if (p >= 10000000) return `₹${(p/10000000).toFixed(1)} Cr`;
    if (p >= 100000)   return `₹${(p/100000).toFixed(0)}L`;
    return `₹${p}`;
  }

  clearAll() {
    this.carType.set('All'); this.usedKmRange.set('All');
    this.selectedFuel.set('All'); this.selectedTransmission.set('All');
    this.selectedBodyType.set('All'); this.selectedMake.set('All');
    this.maxPrice.set(20000000); this.minYear.set(2018); this.searchQuery.set('');
  }
}
