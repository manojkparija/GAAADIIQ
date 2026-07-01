import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../services/seo.service';

interface Alert {
  id: string; make: string; model: string; targetPrice: number; email: string; createdAt: string;
}

@Component({
  selector: 'app-price-alerts',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './price-alerts.component.html',
  styleUrl: './price-alerts.component.scss'
})
export class PriceAlertsComponent {
  form = { make: '', model: '', targetPrice: '', email: '' };
  alerts = signal<Alert[]>(this.load());
  submitted = signal(false);

  makes = ['Maruti Suzuki','Hyundai','Tata','Kia','MG','Toyota','Honda','Mahindra'];

  constructor(private seo: SeoService) {
    seo.setPage('Price Drop Alerts', 'Set your target price and get notified the moment a car listing drops below it.');
  }

  submit() {
    if (!this.form.make || !this.form.model || !this.form.targetPrice || !this.form.email) return;
    const alert: Alert = {
      id: Date.now().toString(),
      make: this.form.make, model: this.form.model,
      targetPrice: +this.form.targetPrice, email: this.form.email,
      createdAt: new Date().toLocaleDateString('en-IN')
    };
    this.alerts.update(a => [alert, ...a]);
    this.save();
    this.form = { make: '', model: '', targetPrice: '', email: '' };
    this.submitted.set(true);
    setTimeout(() => this.submitted.set(false), 3000);
  }

  remove(id: string) {
    this.alerts.update(a => a.filter(x => x.id !== id));
    this.save();
  }

  private save() { localStorage.setItem('gaadiiq_alerts', JSON.stringify(this.alerts())); }
  private load(): Alert[] {
    try { return JSON.parse(localStorage.getItem('gaadiiq_alerts') || '[]'); } catch { return []; }
  }
  formatPrice(p: number) { return `₹${(p/100000).toFixed(1)}L`; }
}
