# Brochure Gallery Component Usage Guide

## Overview

The `BrochureGalleryComponent` displays extracted images from uploaded PDF brochures. It filters images by car make/model and provides a gallery view with lightbox preview.

## Installation

### 1. Add to Your Component

Import the component in your page component:

```typescript
import { BrochureGalleryComponent } from './components/brochure-gallery.component';

@Component({
  selector: 'app-car-details',
  imports: [BrochureGalleryComponent, CommonModule, ...],
  template: `
    <app-brochure-gallery 
      [make]="'Maruti'"
      [model]="'Dzire'"
      [limit]="30">
    </app-brochure-gallery>
  `
})
export class CarDetailsComponent {
  // ...
}
```

### 2. Basic Usage

```html
<!-- Show all brochure images for a car -->
<app-brochure-gallery 
  make="Maruti Suzuki"
  model="Dzire">
</app-brochure-gallery>
```

### 3. With Variant Filter

```html
<!-- Filter by specific variant -->
<app-brochure-gallery 
  make="Maruti Suzuki"
  model="Dzire"
  variant="ZXi+">
</app-brochure-gallery>
```

### 4. Custom Limit

```html
<!-- Load more images -->
<app-brochure-gallery 
  make="Maruti Suzuki"
  model="Dzire"
  [limit]="60">
</app-brochure-gallery>
```

## Component Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| `make` | string | undefined | Car manufacturer (e.g., "Maruti Suzuki") |
| `model` | string | undefined | Car model (e.g., "Dzire") |
| `variant` | string | undefined | Specific variant (e.g., "ZXi+") |
| `limit` | number | 30 | Max images to load (1-200) |

## Features

✅ **Responsive Grid** - Auto-fills 150px columns  
✅ **Lazy Loading** - Images load on demand  
✅ **Hover Effects** - Visual feedback on interaction  
✅ **Lightbox Preview** - Click any image to expand  
✅ **Image Metadata** - Shows view angle (front, side, rear) and kind (exterior, interior)  
✅ **Selection Highlight** - Selected image highlighted with blue border  

## API Endpoint

The component uses the existing endpoint:

```
GET /api/brochures/images?make=Maruti&model=Dzire&limit=30
```

**Response Format:**

```json
[
  {
    "id": "uuid",
    "storage_key": "brochures/job-id/002.jpg",
    "thumbnail_key": "brochures/job-id/002_thumb.webp",
    "width": 1088,
    "height": 1393,
    "make": "Maruti Suzuki",
    "model": "Dzire",
    "variant": "ZXi+",
    "content_type": "image/jpeg",
    "kind": "exterior",
    "view": "front",
    "created_at": "2026-08-01T13:35:46Z"
  }
]
```

## Integration Examples

### On Car Details Page

```typescript
@Component({
  template: `
    <div class="car-details">
      <h1>{{ car.make }} {{ car.model }}</h1>
      <p>{{ car.description }}</p>
      
      <!-- Show brochure gallery -->
      <app-brochure-gallery 
        [make]="car.make"
        [model]="car.model">
      </app-brochure-gallery>
      
      <!-- Other content -->
    </div>
  `
})
export class CarDetailsComponent {
  car = {
    make: 'Maruti Suzuki',
    model: 'Dzire'
  };
}
```

### In Car Comparison

```html
<div class="comparison-grid">
  <div class="car-column" *ngFor="let car of cars">
    <h3>{{ car.make }} {{ car.model }}</h3>
    
    <app-brochure-gallery 
      [make]="car.make"
      [model]="car.model"
      [limit]="12">
    </app-brochure-gallery>
  </div>
</div>
```

### Conditional Display

```html
<div *ngIf="selectedCar">
  <app-brochure-gallery 
    [make]="selectedCar.make"
    [model]="selectedCar.model">
  </app-brochure-gallery>
</div>

<div *ngIf="!selectedCar" class="empty-state">
  Select a car to view brochure images
</div>
```

## Styling Customization

The component uses scoped styles. To override, add custom CSS:

```css
/* Make grid wider */
::ng-deep .gallery-grid {
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}

/* Change lightbox background */
::ng-deep .lightbox-overlay {
  background: rgba(0, 0, 0, 0.95);
}

/* Larger gallery items */
::ng-deep .gallery-item img {
  height: 200px;
}
```

## Error Handling

The component handles:
- ✅ No images found (shows "No brochure images available")
- ✅ API errors (logs to console, shows empty state)
- ✅ Network timeouts (handled by HttpClient)

## Performance Considerations

- **Lazy Loading**: Images load only when visible (`loading="lazy"`)
- **Thumbnail Support**: Uses `thumbnail_key` for faster previews (future enhancement)
- **Grid Limit**: Default 30 images, max 200 per request to prevent oversized responses
- **Standalone Component**: No dependency on feature modules, tree-shakeable

## Next Steps

1. Copy the component to your Angular project
2. Import where needed
3. Add to your car details/comparison pages
4. Test with uploaded brochures

The backend API is ready to serve the images!
