import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';

/**
 * Loads the Google Maps JavaScript API, once, on demand.
 *
 * WHY NOT A <script> IN index.html
 *
 * Because then every visitor to every page pays for it. The Maps bundle is
 * several hundred kilobytes and — more to the point — Google bills per map
 * load, so a tag in index.html turns the homepage, the car listings and the
 * EMI calculator into billable map loads for a map nobody asked to see. It is
 * fetched here only when a page actually needs one.
 *
 * The in-flight promise is cached rather than just a "loaded" flag: two
 * components asking at the same moment must share one script tag, not race to
 * append two. Appending twice logs a console warning and re-runs the callback.
 */
@Injectable({ providedIn: 'root' })
export class GoogleMapsLoader {
  private promise: Promise<void> | null = null;

  /** Null until an attempt has been made; then the reason it failed, or ''. */
  readonly failure = signal<string | null>(null);

  /** False when no key is configured — the caller shows a list instead. */
  configured(): boolean {
    return !!(environment as { googleMapsApiKey?: string }).googleMapsApiKey;
  }

  load(): Promise<void> {
    if (this.promise) return this.promise;

    const key = (environment as { googleMapsApiKey?: string }).googleMapsApiKey;
    if (!key) {
      // Not an error worth throwing: the page has a working list view, and a
      // missing key is a deployment state rather than a fault.
      this.failure.set('no-key');
      this.promise = Promise.reject(new Error('No Google Maps key configured'));
      return this.promise;
    }

    this.promise = new Promise<void>((resolve, reject) => {
      // Someone else may already have put it there — a hot reload, or a second
      // entry point added later.
      if ((window as unknown as { google?: { maps?: unknown } }).google?.maps) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      // `loading=async` is what Google asks for and silences the console
      // warning about it. `marker` is needed for AdvancedMarkerElement.
      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
        `&libraries=marker&loading=async&v=weekly`;
      script.async = true;
      script.defer = true;

      script.onerror = () => {
        // Fires for a network failure or a blocked request. An invalid key or
        // a referrer rejection does NOT come through here — Google loads the
        // script fine and then complains on the map itself, which is why the
        // component also listens for gm_authFailure.
        this.failure.set('script-failed');
        reject(new Error('Google Maps failed to load'));
      };
      script.onload = () => {
        this.failure.set('');
        resolve();
      };

      // The one error that actually matters in production, and the one that
      // does not surface any other way: a key rejected for this referrer.
      // Google calls this global and otherwise only prints to the console,
      // leaving a grey box with no explanation.
      (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
        this.failure.set('auth');
      };

      document.head.appendChild(script);
    });

    return this.promise;
  }
}
