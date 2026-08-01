import { Component, Input, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';

interface BrochureImage {
  id: string;
  storage_key: string;
  thumbnail_key?: string;
  width: number;
  height: number;
  make?: string;
  model?: string;
  variant?: string;
  content_type: string;
  kind?: string;
  view?: string;
  created_at: string;
}

@Component({
  selector: 'app-brochure-gallery',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="brochure-gallery-container">
      <h3>Brochure Images</h3>

      <div *ngIf="loading" class="loading">
        Loading images...
      </div>

      <div *ngIf="!loading && images.length === 0" class="no-images">
        No brochure images available
      </div>

      <div *ngIf="!loading && images.length > 0" class="gallery-grid">
        <div *ngFor="let image of images" class="gallery-item">
          <img
            [src]="getImageUrl(image.storage_key)"
            [alt]="getImageAlt(image)"
            loading="lazy"
            (click)="selectImage(image)"
            [class.selected]="selectedImage?.id === image.id"
          />
          <div class="image-meta">
            <small *ngIf="image.view">{{ image.view }}</small>
            <small *ngIf="image.kind">{{ image.kind }}</small>
          </div>
        </div>
      </div>

      <div *ngIf="selectedImage" class="lightbox-overlay" (click)="closeImage()">
        <div class="lightbox-content" (click)="$event.stopPropagation()">
          <button class="close-btn" (click)="closeImage()">×</button>
          <img
            [src]="getImageUrl(selectedImage.storage_key)"
            [alt]="getImageAlt(selectedImage)"
            class="lightbox-image"
          />
          <div class="lightbox-info">
            <p *ngIf="selectedImage.make">
              {{ selectedImage.make }} {{ selectedImage.model }}
              <span *ngIf="selectedImage.variant">{{ selectedImage.variant }}</span>
            </p>
            <small>{{ selectedImage.created_at | date: 'short' }}</small>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .brochure-gallery-container {
      padding: 20px;
      background: #f9fafb;
      border-radius: 8px;
      margin: 20px 0;
    }

    h3 {
      margin-top: 0;
      margin-bottom: 16px;
      color: #1f2937;
    }

    .loading, .no-images {
      text-align: center;
      padding: 40px 20px;
      color: #6b7280;
    }

    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }

    .gallery-item {
      position: relative;
      overflow: hidden;
      border-radius: 6px;
      background: white;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .gallery-item:hover {
      transform: translateY(-4px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .gallery-item img {
      width: 100%;
      height: 150px;
      object-fit: cover;
      display: block;
    }

    .gallery-item.selected {
      box-shadow: 0 0 0 3px #3b82f6;
    }

    .image-meta {
      padding: 6px;
      background: white;
      font-size: 11px;
      color: #6b7280;
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }

    .image-meta small {
      background: #e5e7eb;
      padding: 2px 6px;
      border-radius: 3px;
    }

    .lightbox-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.9);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .lightbox-content {
      position: relative;
      max-width: 90vw;
      max-height: 90vh;
      background: white;
      border-radius: 8px;
      overflow: hidden;
    }

    .close-btn {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 40px;
      height: 40px;
      border: none;
      background: rgba(0, 0, 0, 0.5);
      color: white;
      font-size: 28px;
      cursor: pointer;
      border-radius: 4px;
      z-index: 1001;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .close-btn:hover {
      background: rgba(0, 0, 0, 0.7);
    }

    .lightbox-image {
      width: 100%;
      height: auto;
      display: block;
      max-height: 80vh;
    }

    .lightbox-info {
      padding: 16px;
      background: #f9fafb;
      border-top: 1px solid #e5e7eb;
    }

    .lightbox-info p {
      margin: 0 0 8px 0;
      font-weight: 500;
      color: #1f2937;
    }

    .lightbox-info small {
      color: #6b7280;
    }
  `]
})
export class BrochureGalleryComponent implements OnInit {
  @Input() make?: string;
  @Input() model?: string;
  @Input() variant?: string;
  @Input() limit: number = 30;

  images: BrochureImage[] = [];
  selectedImage: BrochureImage | null = null;
  loading = false;
  apiUrl = '/api/brochures/images'; // Adjust to your API base URL

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.loadImages();
  }

  loadImages(): void {
    this.loading = true;
    let params = `limit=${this.limit}`;

    if (this.make) params += `&make=${encodeURIComponent(this.make)}`;
    if (this.model) params += `&model=${encodeURIComponent(this.model)}`;
    if (this.variant) params += `&variant=${encodeURIComponent(this.variant)}`;

    this.http.get<BrochureImage[]>(`${this.apiUrl}?${params}`).subscribe({
      next: (data) => {
        this.images = data;
        this.loading = false;
      },
      error: (error) => {
        console.error('Failed to load brochure images', error);
        this.loading = false;
      }
    });
  }

  getImageUrl(storageKey: string): string {
    return `/api/media/${storageKey}`;
  }

  getImageAlt(image: BrochureImage): string {
    const parts = [];
    if (image.make) parts.push(image.make);
    if (image.model) parts.push(image.model);
    if (image.view) parts.push(image.view);
    return parts.join(' ') || 'Brochure image';
  }

  selectImage(image: BrochureImage): void {
    this.selectedImage = image;
  }

  closeImage(): void {
    this.selectedImage = null;
  }
}
