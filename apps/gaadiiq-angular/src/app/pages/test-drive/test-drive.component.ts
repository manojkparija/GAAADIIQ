import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { CarsDataService, Car } from '../../services/cars-data.service';
import { SeoService } from '../../services/seo.service';

@Component({
  selector: 'app-test-drive',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './test-drive.component.html',
  styleUrl: './test-drive.component.scss'
})
export class TestDriveComponent {
  allCars: Car[];
  searchQuery = signal('');
  selectedCar = signal<Car | null>(null);
  submitted = signal(false);
  showDropdown = signal(false);

  form = { name: '', phone: '', email: '', date: '', time: '', location: '', notes: '' };

  timeSlots = ['9:00 AM','10:00 AM','11:00 AM','12:00 PM','2:00 PM','3:00 PM','4:00 PM','5:00 PM','6:00 PM'];

  get minDate(): string {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }

  get filteredCars(): Car[] {
    const q = this.searchQuery().toLowerCase();
    if (!q) return this.allCars.slice(0, 8);
    return this.allCars.filter(c => `${c.make} ${c.model} ${c.year}`.toLowerCase().includes(q)).slice(0, 6);
  }

  constructor(private carsData: CarsDataService, private seo: SeoService, private route: ActivatedRoute) {
    this.allCars = carsData.getAll();
    seo.setPage('Book Test Drive', 'Book a test drive for any car in our verified database. Choose your date, time, and location.');
    this.route.queryParams.subscribe(params => {
      if (params['carId']) {
        const car = this.allCars.find(c => c.id === +params['carId']);
        if (car) this.selectedCar.set(car);
      }
    });
  }

  selectCar(car: Car) { this.selectedCar.set(car); this.searchQuery.set(''); this.showDropdown.set(false); }

  submit() {
    if (!this.selectedCar() || !this.form.name || !this.form.phone || !this.form.date || !this.form.time) return;
    this.submitted.set(true);
  }

  reset() { this.selectedCar.set(null); this.submitted.set(false); this.form = { name:'', phone:'', email:'', date:'', time:'', location:'', notes:'' }; }
  formatPrice(p: number) { return `₹${(p/100000).toFixed(1)}L`; }
}
