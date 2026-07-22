import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { CarsDataService, Car } from '../../services/cars-data.service';
import { SeoService } from '../../services/seo.service';
import { TestDriveService } from '../../services/test-drive.service';
import { SellersService } from '../../services/sellers.service';
import { SentimentService } from '../../services/sentiment.service';
import { SupabaseService } from '../../services/supabase.service';

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
  submitting = signal(false);
  submitError = signal('');
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

  constructor(
    private carsData: CarsDataService,
    private seo: SeoService,
    private route: ActivatedRoute,
    private testDriveSvc: TestDriveService,
    private sellersSvc: SellersService,
    private sentimentSvc: SentimentService,
    private sb: SupabaseService,
  ) {
    this.allCars = carsData.getAll();
    seo.setPage('Book Test Drive', 'Book a test drive for any car in our verified database. Choose your date, time, and location.');
    this.route.queryParams.subscribe(params => {
      if (params['carId']) {
        const car = this.allCars.find(c => String(c.id) === String(params['carId']));
        if (car) this.selectedCar.set(car);
      }
    });
  }

  selectCar(car: Car) { this.selectedCar.set(car); this.searchQuery.set(''); this.showDropdown.set(false); }

  async submit() {
    const car = this.selectedCar();
    if (!car || !this.form.name || !this.form.phone || !this.form.date || !this.form.time) return;

    this.submitting.set(true);
    this.submitError.set('');

    const seller = await this.sellersSvc.getForCar(car.id);

    const ok = await this.testDriveSvc.submit({
      car_id: car.id,
      car_make: car.make,
      car_model: car.model,
      car_year: car.year,
      buyer_name: this.form.name,
      buyer_phone: this.form.phone,
      buyer_email: this.form.email || undefined,
      preferred_date: this.form.date,
      preferred_time: this.form.time,
      location: this.form.location || undefined,
      notes: this.form.notes || undefined,
      seller_id: seller.id,
    });

    this.submitting.set(false);
    if (ok) {
      this.submitted.set(true);
      const { data } = await this.sb.client.auth.getSession();
      const buyerId = data.session?.user?.id;
      if (buyerId) {
        this.sentimentSvc.trackPublic(seller.email, buyerId, 'test_drive_request');
      }
    } else {
      this.submitError.set('Booking failed — please try again or call us directly.');
    }
  }

  reset() {
    this.selectedCar.set(null);
    this.submitted.set(false);
    this.submitError.set('');
    this.form = { name:'', phone:'', email:'', date:'', time:'', location:'', notes:'' };
  }

  formatPrice(p: number) { return `₹${(p/100000).toFixed(1)}L`; }
}
