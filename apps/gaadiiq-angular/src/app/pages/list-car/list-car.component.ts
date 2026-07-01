import { Component, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

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

  constructor(public auth: AuthService, private router: Router) {
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
    await new Promise(r => setTimeout(r, 1500));
    this.loading.set(false);
    this.submitted.set(true);
  }
}
