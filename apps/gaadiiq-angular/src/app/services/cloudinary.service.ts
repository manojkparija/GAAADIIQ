import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

declare const cloudinary: any;

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

  /** Returns the optimised URL for a given public_id at a target width */
  imageUrl(publicId: string, width = 800): string {
    return `https://res.cloudinary.com/${this.cloudName}/image/upload/f_auto,q_auto,w_${width},c_fill/${publicId}`;
  }

  /** Opens the Cloudinary Upload Widget and resolves with the uploaded files */
  openWidget(options: {
    maxFiles?: number;
    folder?: string;
  } = {}): Promise<CloudinaryResult[]> {
    return new Promise((resolve, reject) => {
      const widget = cloudinary.createUploadWidget(
        {
          cloudName: this.cloudName,
          uploadPreset: this.uploadPreset,
          folder: options.folder ?? 'gaadiiq/cars',
          multiple: true,
          maxFiles: options.maxFiles ?? 10,
          sources: ['local', 'camera'],
          resourceType: 'image',
          clientAllowedFormats: ['jpg', 'jpeg', 'png', 'webp', 'heic'],
          maxFileSize: 10_000_000, // 10 MB
          cropping: false,
          showAdvancedOptions: false,
          showCompletionButton: true,
          styles: {
            palette: {
              window: '#0B1220',
              windowBorder: '#2F6BFF',
              tabIcon: '#2F6BFF',
              menuIcons: '#FFFFFF',
              textDark: '#FFFFFF',
              textLight: '#AAAAAA',
              link: '#2F6BFF',
              action: '#2F6BFF',
              inactiveTabIcon: '#888888',
              error: '#FF4444',
              inProgress: '#14B8A6',
              complete: '#14B8A6',
              sourceBg: '#0F1927',
            },
          },
        },
        (error: any, result: any) => {
          if (error) { reject(error); return; }
          if (result.event === 'queues-end') {
            const uploaded: CloudinaryResult[] = result.info.files
              .filter((f: any) => f.uploadInfo)
              .map((f: any) => f.uploadInfo as CloudinaryResult);
            widget.close();
            resolve(uploaded);
          }
        }
      );
      widget.open();
    });
  }
}
