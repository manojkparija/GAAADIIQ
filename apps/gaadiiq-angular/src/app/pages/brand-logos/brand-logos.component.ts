import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BRANDS, Brand } from '../../data/brands';

@Component({
  selector: 'app-brand-logos',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './brand-logos.component.html',
  styleUrl: './brand-logos.component.scss'
})
export class BrandLogosComponent {
  brands: Brand[] = BRANDS;

  onImgError(event: Event, brand: Brand) {
    (event.target as HTMLImageElement).style.opacity = '0.2';
  }
}
