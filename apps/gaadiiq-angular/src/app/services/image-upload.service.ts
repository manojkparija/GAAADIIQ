import { Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface UploadedImage {
  path: string;
  url: string;
}

@Injectable({ providedIn: 'root' })
export class ImageUploadService {
  private readonly bucket = 'car-images';

  constructor(private sb: SupabaseService) {}

  publicUrl(path: string): string {
    const { data } = this.sb.client.storage.from(this.bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  async uploadFile(file: File, folder = 'cars'): Promise<UploadedImage> {
    const ext = file.name.split('.').pop() ?? 'jpg';
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const { error } = await this.sb.client.storage
      .from(this.bucket)
      .upload(path, file, { contentType: file.type, upsert: false });

    if (error) throw new Error(error.message);

    return { path, url: this.publicUrl(path) };
  }

  async uploadFiles(files: File[], folder = 'cars'): Promise<UploadedImage[]> {
    return Promise.all(Array.from(files).map(f => this.uploadFile(f, folder)));
  }
}
