import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-car-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './car-detail.component.html',
  styleUrl: './car-detail.component.scss'
})
export class CarDetailComponent {
  activeTab = signal('overview');
  liked = signal(false);
  loan = { amount: 1450000, rate: 8.5, tenure: 60, emi: 0 };

  car = {
    id:1, make:'Hyundai', model:'Creta', variant:'SX(O) 1.5 Turbo', year:2023,
    price:1450000, km:12000, fuel:'Petrol', transmission:'DCT', color:'Phantom Black',
    city:'Delhi', owners:'1st Owner', badge:'🔥 Trending', badgeType:'badge-red',
    rating:4.8, reviews:234, verified:true,
    image:'https://imgd.aeplcdn.com/1200x900/n/cw/ec/106815/creta-exterior-right-front-three-quarter-2.jpeg',
    images:[
      'https://imgd.aeplcdn.com/1200x900/n/cw/ec/106815/creta-exterior-right-front-three-quarter-2.jpeg',
      'https://imgd.aeplcdn.com/1200x900/n/cw/ec/106815/creta-interior-dashboard.jpeg',
      'https://imgd.aeplcdn.com/1200x900/n/cw/ec/106815/creta-exterior-rear-three-quarter.jpeg',
    ],
    specs: [
      { label:'Engine', value:'1.5L Turbo Petrol' },
      { label:'Power', value:'160 bhp' },
      { label:'Torque', value:'253 Nm' },
      { label:'Mileage', value:'16.8 km/l' },
      { label:'Seating', value:'5 Persons' },
      { label:'Boot Space', value:'433 Litres' },
    ],
    features:['Panoramic Sunroof','BOSE Sound System','360° Camera','Level 2 ADAS','Ventilated Seats','Wireless Charging','10.25" Touchscreen','OTA Updates'],
    aiValuation: { fairPrice: 1420000, marketMin: 1350000, marketMax: 1550000, verdict: 'Fair Deal', confidence: 94 }
  };

  activeImg = signal(0);

  ngOnInit() { this.calcEmi(); }

  calcEmi() {
    const r = this.loan.rate / 100 / 12;
    const n = this.loan.tenure;
    const p = this.loan.amount;
    this.loan.emi = Math.round(p * r * Math.pow(1+r,n) / (Math.pow(1+r,n) - 1));
  }

  formatPrice(p: number) { return p >= 100000 ? `₹${(p/100000).toFixed(1)}L` : `₹${p.toLocaleString()}`; }
}
