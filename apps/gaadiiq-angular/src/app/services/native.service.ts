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

  /**
   * A camera/gallery result as a File, so it can go through the same upload
   * path as a file chosen in a browser.
   *
   * The plugins hand back a base64 data URL and ImageUploadService takes
   * File[]. Converting here rather than teaching the uploader about data URLs
   * keeps one upload path: the same size checks, the same storage keys, the
   * same error handling. A second path would be a second set of rules to keep
   * in step, and the one that runs only on a phone is the one that would drift
   * without anyone noticing.
   */
  static photoToFile(photo: NativePhoto, name = `photo-${Date.now()}`): File | null {
    const match = /^data:([^;]+);base64,(.*)$/.exec(photo.dataUrl ?? '');
    if (!match) return null;

    const [, mime, b64] = match;
    let binary: string;
    try {
      binary = atob(b64);
    } catch {
      return null;                       // truncated or malformed payload
    }

    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // Extension from the MIME type the camera reported, not from the format
    // field: `format` is 'jpeg' on Android and 'jpg' on some devices, and the
    // storage key is built from the file name.
    const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    return new File([bytes], `${name}.${ext}`, { type: mime });
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
      // Anything that is not already granted needs asking. This used to test
      // for 'denied' alone, which skips the case that matters most: a fresh
      // install reports 'prompt', so the request never happened and the fix
      // was attempted with no permission behind it.
      //
      // ACCESS_FINE_LOCATION is declared in AndroidManifest.xml, but on
      // Android 6+ declaring is not granting — something has to ask, and this
      // is the only code in the app that does.
      if (perm.location !== 'granted') {
        const asked = await Geolocation.requestPermissions();
        if (asked.location !== 'granted') {
          throw new Error('Location permission was not granted.');
        }
      }
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      // Shape matches browser GeolocationPosition
      return pos as unknown as GeolocationPosition;
    }
    return new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
    );
  }

  // ── Haptics ────────────────────────────────────────────────────────────────

  /**
   * A short buzz to confirm something happened.
   *
   * Deliberately fire-and-forget and never throws: haptics are confirmation,
   * not information. A device with the motor disabled, or a user who turned
   * system haptics off, must not see an error — and no caller should have to
   * wrap this in a try/catch to be safe.
   *
   * No web fallback. The Vibration API is unsupported on iOS Safari and is
   * being restricted elsewhere, and a mistimed buzz on a laptop is worse than
   * silence.
   */
  async tap(style: 'light' | 'medium' | 'heavy' = 'light'): Promise<void> {
    if (!this.isNative) return;
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      const map = {
        light: ImpactStyle.Light,
        medium: ImpactStyle.Medium,
        heavy: ImpactStyle.Heavy,
      } as const;
      await Haptics.impact({ style: map[style] });
    } catch {
      /* no motor, or permission-less denial — nothing to report */
    }
  }

  /** A distinct pattern for "this failed", so it does not feel like success. */
  async buzzError(): Promise<void> {
    if (!this.isNative) return;
    try {
      const { Haptics, NotificationType } = await import('@capacitor/haptics');
      await Haptics.notification({ type: NotificationType.Error });
    } catch { /* as above */ }
  }

  // ── Share ──────────────────────────────────────────────────────────────────

  /**
   * The OS share sheet, falling back to the Web Share API and then the
   * clipboard.
   *
   * Returns whether anything was actually shared, because the three paths fail
   * differently: the native sheet and the web API both reject when the user
   * dismisses them, which is a choice rather than an error, while the clipboard
   * path succeeds without any sheet appearing — and the caller needs to say
   * "Link copied" in that case rather than nothing.
   */
  async share(opts: { title?: string; text?: string; url: string }): Promise<'shared' | 'copied' | 'cancelled'> {
    if (this.isNative) {
      try {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: opts.title, text: opts.text, url: opts.url });
        return 'shared';
      } catch {
        return 'cancelled';
      }
    }

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: opts.title, text: opts.text, url: opts.url });
        return 'shared';
      } catch {
        return 'cancelled';
      }
    }

    try {
      await navigator.clipboard.writeText(opts.url);
      return 'copied';
    } catch {
      return 'cancelled';
    }
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
