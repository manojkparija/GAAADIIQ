import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BrandsService } from '../../services/brands.service';
import { Brand } from '../../data/brands';
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-brand-logos',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './brand-logos.component.html',
  styleUrl: './brand-logos.component.scss'
})
export class BrandLogosComponent {
  constructor(public brandsService: BrandsService) {}

  get brands() { return this.brandsService.brands(); }

  onImgError(event: Event, brand: Brand) {
    (event.target as HTMLImageElement).style.opacity = '0.2';
  }
}
