/**
 * MOB-018: Cloudinary unsigned presets are abusable (anyone with the preset name
 * can upload to our account). All uploads now go through our authenticated FastAPI
 * backend (/upload/image), which validates the JWT, enforces size/type limits,
 * and stores to R2. The public URL returned is served via our CDN.
 *
 * Cloudinary is still used for READ operations (image_url transforms via CDN).
 */
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CloudinaryResult {
  public_id: string;
  secure_url: string;
  width: number;
  height: number;
  format: string;
}

@Injectable({ providedIn: 'root' })
export class CloudinaryService {
  private readonly cloudName = environment.cloudinary.cloudName;
  private readonly http = inject(HttpClient);

  imageUrl(publicId: string, width = 800): string {
    // If it's already a full URL (R2/CDN), return as-is
    if (publicId.startsWith('http')) return publicId;
    return `https://res.cloudinary.com/${this.cloudName}/image/upload/f_auto,q_auto,w_${width},c_fill/${publicId}`;
  }

  /** Upload a single File via our authenticated backend (not Cloudinary directly). */
  async uploadFile(file: File, _folder = 'gaadiiq/cars'): Promise<CloudinaryResult> {
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!ALLOWED_TYPES.includes(file.type)) {
      throw new Error('Only JPEG, PNG, WebP and HEIC images are accepted.');
    }
    if (file.size > 20 * 1024 * 1024) {
      throw new Error('Image must be under 20 MB.');
    }

    const fd = new FormData();
    fd.append('file', file);

    const res = await firstValueFrom(
      this.http.post<{ url: string; filename: string; size_bytes: number }>(
        `${environment.apiUrl}/upload/image`,
        fd,
      )
    );

    return {
      public_id: res.url,
      secure_url: res.url,
      width: 0,
      height: 0,
      format: file.type.split('/')[1] || 'jpeg',
    };
  }

  /** Upload multiple files in parallel. */
  async uploadFiles(files: File[], folder = 'gaadiiq/cars'): Promise<CloudinaryResult[]> {
    return Promise.all(Array.from(files).map(f => this.uploadFile(f, folder)));
  }
}
