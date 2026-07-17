import { Injectable } from '@angular/core';
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
  private readonly uploadPreset = environment.cloudinary.uploadPreset;

  imageUrl(publicId: string, width = 800): string {
    return `https://res.cloudinary.com/${this.cloudName}/image/upload/f_auto,q_auto,w_${width},c_fill/${publicId}`;
  }

  /** Upload a single File to Cloudinary via unsigned REST API */
  async uploadFile(file: File, folder = 'gaadiiq/cars'): Promise<CloudinaryResult> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', this.uploadPreset);
    fd.append('folder', folder);

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${this.cloudName}/image/upload`,
      { method: 'POST', body: fd }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Upload failed (${res.status})`);
    }
    const data = await res.json();
    return {
      public_id: data.public_id,
      secure_url: data.secure_url,
      width: data.width,
      height: data.height,
      format: data.format,
    };
  }

  /** Upload multiple files, returns results in order */
  async uploadFiles(files: File[], folder = 'gaadiiq/cars'): Promise<CloudinaryResult[]> {
    return Promise.all(Array.from(files).map(f => this.uploadFile(f, folder)));
  }
}
