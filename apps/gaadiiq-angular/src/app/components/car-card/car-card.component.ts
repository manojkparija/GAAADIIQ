import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../icon/icon.component';

interface Car {
  id: string; make: string; model: string; year: number; price: number;
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

  onImgLoad(e: Event) {
    (e.target as HTMLImageElement).style.opacity = '1';
  }

  onImgError(e: Event) {
    const img = e.target as HTMLImageElement;
    img.onerror = null;
    img.src = 'assets/cars/placeholder.svg';
    img.style.opacity = '1';
  }

  formatPrice(p: number): string {
    if (p >= 100000) return `₹${(p/100000).toFixed(1)}L`;
    return `₹${p.toLocaleString()}`;
  }

  formatKm(km: number): string {
    if (km === 0) return 'Brand New';
    if (km >= 1000) return `${(km/1000).toFixed(0)}k km`;
    return `${km} km`;
  }

  /**
   * Serve Cloudinary images at card size with auto format+quality, falling back
   * to the placeholder when a car has no photograph of its own.
   *
   * Brochure photography used to fill that gap. It no longer does: a picture
   * scraped out of a manufacturer PDF is not this car, and a card that shows
   * one is showing a stock image as though it were the vehicle. A placeholder
   * says "no photograph" honestly.
   */
  optimisedImage(url: string): string {
    const resolved = url || 'assets/cars/placeholder.svg';
    const match = resolved.match(/res\.cloudinary\.com\/([^/]+)\/image\/upload\/(?:[^/]+\/)?(.+)/);
    if (match) {
      const [, cloud, publicId] = match;
      return `https://res.cloudinary.com/${cloud}/image/upload/f_auto,q_auto,w_600,h_380,c_fill/${publicId}`;
    }
    return resolved;
  }
}
