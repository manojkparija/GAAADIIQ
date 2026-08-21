import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../icon/icon.component';

interface Car {
  id: string; make: string; model: string; year: number; price: number;
  km: number; fuel: string; transmission: string; badge: string; badgeType: string;
  image: string; rating: number; reviews: number; verified: boolean;
  /**
   * The band this model's published trims span, when it has any. Absent on a
   * used listing, which has one asking price and no trims.
   */
  variantPriceMin?: number; variantPriceMax?: number;
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

  /**
   * What this card quotes.
   *
   * `car.price` is the catalogue row's own ex-showroom figure, maintained by
   * hand and separately from the trims — so it drifts. A Fronx read "₹9.3L"
   * here while the New Cars card and the detail page, both of which read the
   * published trims, said "₹6.84L – ₹11.98L". The same car, contradicting
   * itself on two screens a buyer sees side by side.
   *
   * A used car has no trims, so the band is absent and its asking price
   * stands — that is the only price such a listing has.
   *
   * A method rather than a computed(): `car` is a plain @Input field, not a
   * signal, and a computed() over it would evaluate once and then report a
   * stale answer for every card that reuses the component (CLAUDE.md).
   */
  displayPrice(): string {
    const lo = this.car.variantPriceMin;
    const hi = this.car.variantPriceMax;
    if (lo == null || hi == null) return this.formatPrice(this.car.price);
    return lo === hi
      ? this.formatPrice(lo)
      : `${this.formatPrice(lo)} – ${this.formatPrice(hi)}`;
  }

  /** The low end of whatever is quoted: an EMI is "from" the cheapest trim. */
  priceForEmi(): number {
    return this.car.variantPriceMin ?? this.car.price;
  }

  /** "from" only when the figure above is a band rather than one price. */
  emiFrom(): string {
    const lo = this.car.variantPriceMin;
    const hi = this.car.variantPriceMax;
    return lo != null && hi != null && lo !== hi ? 'from' : '';
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
