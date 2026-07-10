import { Component, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { MyListingsService } from '../../services/my-listings.service';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-list-car',
  standalone: true,
  imports: [RouterLink, CommonModule, FormsModule],
  templateUrl: './list-car.component.html',
  styleUrl: './list-car.component.scss'
})
export class ListCarComponent {
  step = signal(1);
  totalSteps = 3;
  submitted = signal(false);
  loading = signal(false);

  makes = ['Maruti Suzuki','Hyundai','Tata','Mahindra','Honda','Toyota','Kia','MG Motor','Ford','Volkswagen','Skoda','Renault','Nissan','BMW','Mercedes-Benz','Audi','Other'];
  fuelTypes = ['Petrol','Diesel','CNG','Electric','Hybrid'];
  transmissions = ['Manual','Automatic','AMT','CVT','DCT'];
  ownerOptions = ['1st Owner','2nd Owner','3rd Owner','4th+ Owner'];
  bodyTypes = ['Hatchback','Sedan','SUV','MUV','Coupe','Convertible','Pickup','Van'];

  form = {
    make: '', model: '', variant: '', year: new Date().getFullYear(), km: '',
    fuel: '', transmission: '', owners: '', color: '', city: '',
    price: '', description: '', name: '', phone: '', email: '',
    bodyType: ''
  };

  constructor(public auth: AuthService, private myListings: MyListingsService, private router: Router, private sb: SupabaseService) {
    const user = auth.currentUser();
    if (user) {
      this.form.name = user.name;
      this.form.email = user.email;
    }
  }

  get years() {
    const y = [];
    for (let i = new Date().getFullYear(); i >= 2000; i--) y.push(i);
    return y;
  }

  nextStep() { if (this.step() < this.totalSteps) this.step.update(v => v + 1); }
  prevStep() { if (this.step() > 1) this.step.update(v => v - 1); }

  async onSubmit() {
    this.loading.set(true);
    const user = this.auth.currentUser();

    // Insert into Supabase so customers can see the listing
    const { data: inserted } = await this.sb.client
      .from('cars')
      .insert({
        make: this.form.make,
        model: this.form.model,
        variant: this.form.variant || null,
        year: this.form.year,
        km: +this.form.km,
        fuel: this.form.fuel,
        transmission: this.form.transmission,
        owners: this.form.owners || null,
        color: this.form.color || null,
        city: this.form.city || null,
        price: +this.form.price,
        body_type: this.form.bodyType || null,
        badge: 'Used',
        badge_type: 'used',
        seller_email: this.form.email,
        seller_id: user?.sellerId ?? null,
        is_seller_listing: true,
        verified: false,
        rating: 0,
        reviews: 0,
      })
      .select('id')
      .single();

    // Also save to local MyListings so seller sees it in My Listings page
    this.myListings.add({
      make: this.form.make, model: this.form.model, variant: this.form.variant,
      year: this.form.year, km: +this.form.km, fuel: this.form.fuel,
      transmission: this.form.transmission, owners: this.form.owners,
      color: this.form.color, city: this.form.city, price: +this.form.price,
      description: this.form.description, bodyType: this.form.bodyType,
      name: this.form.name, phone: this.form.phone, email: this.form.email,
      supabaseId: inserted?.id ?? null,
    });

    this.loading.set(false);
    this.submitted.set(true);
  }
}
