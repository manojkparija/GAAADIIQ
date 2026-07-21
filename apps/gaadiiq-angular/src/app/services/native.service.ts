/**
 * NativeService — thin wrapper around Capacitor native plugins.
 * Falls back gracefully to web APIs when running in a browser.
 *
 * Plugins used (declare in package.json if not already present):
 *   @capacitor/camera, @capacitor/geolocation,
 *   @capacitor/preferences, @capacitor/filesystem,
 *   @capacitor/push-notifications, @capacitor/local-notifications
 */
import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';

export interface NativePhoto {
  dataUrl: string;   // base64 data URL
  format: string;
  path?: string;
}

@Injectable({ providedIn: 'root' })
export class NativeService {
  readonly isNative = Capacitor.isNativePlatform();
  readonly platform  = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'

  // ── Camera ────────────────────────────────────────────────────────────────

  async pickPhoto(): Promise<NativePhoto | null> {
    if (this.isNative) {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      const perm = await Camera.checkPermissions();
      if (perm.photos === 'denied') {
        await Camera.requestPermissions({ permissions: ['photos'] });
      }
      const image = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Photos,
        quality: 80,
      });
      return { dataUrl: image.dataUrl!, format: image.format };
    }
    // Web fallback — open file input
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = () => resolve({ dataUrl: reader.result as string, format: file.type });
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }

  async takePhoto(): Promise<NativePhoto | null> {
    if (this.isNative) {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      const perm = await Camera.checkPermissions();
      if (perm.camera === 'denied') {
        await Camera.requestPermissions({ permissions: ['camera'] });
      }
      const image = await Camera.getPhoto({
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        quality: 80,
      });
      return { dataUrl: image.dataUrl!, format: image.format };
    }
    // Web: same as pick since no native camera
    return this.pickPhoto();
  }

  // ── Geolocation ────────────────────────────────────────────────────────────

  async getCurrentPosition(): Promise<GeolocationPosition | null> {
    if (this.isNative) {
      const { Geolocation } = await import('@capacitor/geolocation');
      const perm = await Geolocation.checkPermissions();
      if (perm.location === 'denied') {
        await Geolocation.requestPermissions();
      }
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      // Shape matches browser GeolocationPosition
      return pos as unknown as GeolocationPosition;
    }
    return new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
    );
  }

  // ── Preferences (key-value storage) ───────────────────────────────────────

  async getPreference(key: string): Promise<string | null> {
    if (this.isNative) {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key });
      return value;
    }
    return localStorage.getItem(key);
  }

  async setPreference(key: string, value: string): Promise<void> {
    if (this.isNative) {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key, value });
      return;
    }
    localStorage.setItem(key, value);
  }

  async removePreference(key: string): Promise<void> {
    if (this.isNative) {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key });
      return;
    }
    localStorage.removeItem(key);
  }

  // ── Root / Jailbreak detection (MOB-037) ─────────────────────────────────

  /**
   * Heuristic root/jailbreak detection using device feature signals.
   * Returns true if the device is likely rooted/jailbroken.
   * NOTE: This is a best-effort client-side check — it can be bypassed
   * on a rooted device. For production, integrate @capacitor-community/device-security
   * or use Play Integrity API (Android) / DeviceCheck (iOS) for stronger attestation.
   */
  async isRootedOrJailbroken(): Promise<boolean> {
    if (!this.isNative) return false;
    try {
      // Check via @capacitor/device — SafetyNet/Play Integrity must be integrated separately
      const { Device } = await import('@capacitor/device');
      const info = await Device.getInfo();
      // Emulator detection (common on rooted test setups)
      if (info.isVirtual) return true;
      // Additional heuristics can be plugged in here
      return false;
    } catch {
      return false;
    }
  }

  // ── Push Notifications (register token) ───────────────────────────────────

  async registerPush(): Promise<string | null> {
    if (!this.isNative) return null;
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt') {
      const req = await PushNotifications.requestPermissions();
      if (req.receive !== 'granted') return null;
    }
    await PushNotifications.register();
    return new Promise(resolve => {
      PushNotifications.addListener('registration', (token: { value: string }) => resolve(token.value));
      PushNotifications.addListener('registrationError', () => resolve(null));
    });
  }
}
