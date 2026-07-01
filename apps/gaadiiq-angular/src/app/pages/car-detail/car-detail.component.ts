import { Component, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { CarsDataService, Car } from '../../services/cars-data.service';

@Component({
  selector: 'app-car-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './car-detail.component.html',
  styleUrl: './car-detail.component.scss'
})
export class CarDetailComponent implements OnInit {
  activeTab = signal('overview');
  liked = signal(false);
  loan = { amount: 0, rate: 8.5, tenure: 60, emi: 0 };
  car!: Car;
  activeImg = signal(0);
  notFound = false;

  constructor(private route: ActivatedRoute, private carsData: CarsDataService) {}

  ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    const found = this.carsData.getById(id);
    if (found) {
      this.car = found;
    } else {
      this.notFound = true;
      this.car = this.carsData.getAll()[0];
    }
    this.loan.amount = this.car.price;
    this.calcEmi();
  }

  calcEmi() {
    const r = this.loan.rate / 100 / 12;
    const n = this.loan.tenure;
    const p = this.loan.amount;
    this.loan.emi = Math.round(p * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1));
  }

  formatPrice(p: number) { return p >= 100000 ? `₹${(p / 100000).toFixed(1)}L` : `₹${p.toLocaleString()}`; }
}
