import {
  Component, signal, computed, inject, OnInit,
  ChangeDetectionStrategy, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-admin-car-images',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-car-images.component.html',
  styleUrls: ['./admin-car-images.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminCarImagesComponent implements OnInit {
  auth = inject(AuthService);

  // File selection
  dragOver = signal(false);
  selectedFiles = signal<File[]>([]);

  // Upload size management
  maxUploadMb = 100; // Must match backend MEDIA_MAX_UPLOAD_MB
  maxUploadBytes = this.maxUploadMb * 1024 * 1024;
  totalUploadSize = computed(() => {
    return this.selectedFiles().reduce((sum, f) => sum + f.size, 0);
  });
  uploadSizeWarning = computed(() => {
    const total = this.totalUploadSize();
    const percent = (total / this.maxUploadBytes) * 100;
    if (percent > 90) return 'danger'; // >90% = red warning
    if (percent > 75) return 'warning'; // >75% = yellow warning
    return null;
  });
  uploadSizeExceeded = computed(() => {
    return this.totalUploadSize() > this.maxUploadBytes;
  });

  // UI state
  toastMsg = signal('');
  private toastTimer: any;

  // Inspection state
  inspectResults = signal<SuggestedMetadata[]>([]);
  isInspecting = signal(false);
  showMetadataGrid = signal(false);

  // Upload state
  isUploading = signal(false);
  uploadProgress = signal(0);
  uploadError = signal('');
  uploadResults = signal<UploadResult | null>(null);

  // Form state - shared across all files in batch
  make = signal('');
  model = signal('');
  modelYear = signal<number | null>(null);
  category = signal(''); // Body type: SUV, Sedan, etc.
  fuelType = signal('');
  transmission = signal('');
  imageCategory = signal(''); // exterior_front, interior_dashboard, etc.
  variant = signal('');
  colour = signal('');
  source = signal('');
  copyright = signal('');
  license = signal('');

  ngOnInit() {
    // Verify admin is logged in
    if (!this.auth.isAdmin()) {
      this.toast('Admin access required');
    }
  }

  @HostListener('dragover', ['$event']) onDragOver(e: DragEvent) {
    e.preventDefault();
    this.dragOver.set(true);
  }
  @HostListener('dragleave') onDragLeave() {
    this.dragOver.set(false);
  }
  @HostListener('drop', ['$event']) onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragOver.set(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) this.handleFiles(files);
  }

  onFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length) this.handleFiles(files);
    input.value = '';
  }

  private handleFiles(files: File[]) {
    // Filter for images only
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      this.toast('❌ No image files selected. Please choose JPEG, PNG, WebP, HEIC, or TIFF.');
      return;
    }
    if (imageFiles.length < files.length) {
      this.toast(`⚠ ${files.length - imageFiles.length} non-image file(s) excluded`);
    }
    this.selectedFiles.set(imageFiles);
    // Don't show grid yet - let user click "Inspect" first
  }

  async inspectFiles() {
    const files = this.selectedFiles();
    if (!files.length) {
      this.toast('❌ No files selected');
      return;
    }

    this.isInspecting.set(true);
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));

    try {
      const token = await this.getToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      console.log('Fetching /media-admin/inspect with headers:', Object.keys(headers));
      const response = await fetch('http://localhost:8000/media-admin/inspect', {
        method: 'POST',
        body: formData,
        headers,
      });

      console.log('Response status:', response.status, 'Content-Type:', response.headers.get('content-type'));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API error response:', errorText);
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      const results = await response.json();
      this.inspectResults.set(results);
      this.showMetadataGrid.set(true);
      this.toast(`✓ Inspected ${results.length} file(s) — edit metadata below`);
    } catch (err) {
      console.error('Inspect error details:', err);
      this.toast(`❌ Inspection failed: ${err}`);
    } finally {
      this.isInspecting.set(false);
    }
  }

  async uploadImages() {
    const files = this.selectedFiles();
    if (!files.length) {
      this.toast('❌ No files to upload');
      return;
    }

    // Validate mandatory fields
    if (!this.make() || !this.model() || !this.modelYear() || !this.category() ||
        !this.fuelType() || !this.transmission() || !this.imageCategory()) {
      this.toast('❌ Please fill all mandatory fields: Make, Model, Year, Body Type, Fuel, Transmission, Image Category');
      return;
    }

    this.isUploading.set(true);
    this.uploadError.set('');

    const formData = new FormData();
    files.forEach(f => formData.append('files', f));

    // Add metadata
    formData.append('make', this.make());
    formData.append('model', this.model());
    formData.append('model_year', String(this.modelYear()));
    formData.append('category', this.category());
    formData.append('fuel_type', this.fuelType());
    formData.append('transmission', this.transmission());
    formData.append('image_category', this.imageCategory());
    if (this.variant()) formData.append('variant', this.variant());
    if (this.colour()) formData.append('colour', this.colour());
    if (this.source()) formData.append('source', this.source());
    if (this.copyright()) formData.append('copyright', this.copyright());
    if (this.license()) formData.append('license', this.license());

    try {
      const token = await this.getToken();
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch('http://localhost:8000/media-admin/upload', {
        method: 'POST',
        body: formData,
        headers,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || `Upload failed: ${response.status}`);
      }

      const result = await response.json();
      this.uploadResults.set(result);

      if (result.stored > 0) {
        this.toast(`✅ ${result.stored} image(s) uploaded, ${result.deduplicated} duplicate(s) linked`);
        this.resetForm();
      } else if (result.deduplicated > 0) {
        this.toast(`ℹ All ${result.deduplicated} image(s) already in library (deduped)`);
        this.resetForm();
      }

      if (result.errors.length > 0) {
        this.uploadError.set(`Errors: ${result.errors.join('; ')}`);
      }
    } catch (err) {
      this.uploadError.set(String(err));
      this.toast(`❌ Upload failed: ${err}`);
    } finally {
      this.isUploading.set(false);
    }
  }

  cancelUpload() {
    this.resetForm();
    this.toast('Upload cancelled');
  }

  private resetForm() {
    this.selectedFiles.set([]);
    this.inspectResults.set([]);
    this.showMetadataGrid.set(false);
    this.uploadResults.set(null);
    this.uploadError.set('');
    this.make.set('');
    this.model.set('');
    this.modelYear.set(null);
    this.category.set('');
    this.fuelType.set('');
    this.transmission.set('');
    this.imageCategory.set('');
    this.variant.set('');
    this.colour.set('');
    this.source.set('');
    this.copyright.set('');
    this.license.set('');
  }

  private async getToken(): Promise<string> {
    try {
      const response = await (window as any).supabaseClient?.auth.getSession();
      return response?.data?.session?.access_token || '';
    } catch (err) {
      console.warn('Failed to get Supabase token:', err);
      return '';
    }
  }

  private toast(msg: string) {
    this.toastMsg.set(msg);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastMsg.set(''), 4000);
  }

  // Helpers for template
  imageCategoryOptions = [
    'exterior_front', 'exterior_rear', 'exterior_left', 'exterior_right',
    'front_quarter', 'rear_quarter', 'interior_dashboard', 'steering',
    'infotainment', 'seats', 'boot_space', 'engine_bay', 'wheels',
    'sunroof', 'safety', 'accessories', 'gallery', 'three_sixty',
  ];

  fuelOptions = ['Petrol', 'Diesel', 'CNG', 'Hybrid', 'Electric'];
  transmissionOptions = ['Manual', 'Automatic', 'CVT'];
  bodyTypeOptions = ['SUV', 'Sedan', 'Hatchback', 'Coupe', 'Convertible', 'MUV', 'Pickup', 'Wagon'];

  formatCategoryName(category: string): string {
    return category.replace(/_/g, ' ');
  }

  updateInspectResult(index: number, field: string, value: any) {
    const results = this.inspectResults();
    results[index] = { ...results[index], [field]: value };
    this.inspectResults.set([...results]);
  }

  startOver() {
    this.resetForm();
  }
}

interface SuggestedMetadata {
  filename: string;
  make?: string;
  model?: string;
  variant?: string;
  model_year?: number;
  image_category?: string;
  colour?: string;
}

interface UploadResult {
  stored: number;
  deduplicated: number;
  rejected: number;
  images: any[];
  errors: string[];
}
