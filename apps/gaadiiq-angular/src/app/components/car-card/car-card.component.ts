import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../icon/icon.component';

interface Car {
  id: number; make: string; model: string; year: number; price: number;
  km: number; fuel: string; transmission: string; badge: string; badgeType: string;
  image: string; rating: number; reviews: number; verified: boolean;
}

@Component({
  selector: 'app-car-card',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent],
  templateUrl: './car-card.component.html',
  styleUrl: './car-card.component.scss'
})
export class CarCardComponent {
  @Input() car!: Car;
  liked = false;
  Math = Math;

  toggleLike(e: Event) { e.preventDefault(); e.stopPropagation(); this.liked = !this.liked; }

  formatPrice(p: number): string {
    if (p >= 100000) return `₹${(p/100000).toFixed(1)}L`;
    return `₹${p.toLocaleString()}`;
  }

  formatKm(km: number): string {
    if (km === 0) return 'Brand New';
    if (km >= 1000) return `${(km/1000).toFixed(0)}k km`;
    return `${km} km`;
  }

  /** Serve Cloudinary images at card size with auto format+quality; fall back to raw URL */
  optimisedImage(url: string): string {
    if (!url) return 'assets/cars/placeholder.svg';
    const match = url.match(/res\.cloudinary\.com\/([^/]+)\/image\/upload\/(?:[^/]+\/)?(.+)/);
    if (match) {
      const [, cloud, publicId] = match;
      return `https://res.cloudinary.com/${cloud}/image/upload/f_auto,q_auto,w_600,h_380,c_fill/${publicId}`;
    }
    return url;
  }
}
