import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavbarComponent } from './components/navbar/navbar.component';
import { FooterComponent } from './components/footer/footer.component';
import { InstallPwaComponent } from './components/install-pwa/install-pwa.component';
import { ChatWidgetComponent } from './components/chat-widget/chat-widget.component';
import { NativeService } from './services/native.service';
import { SwUpdate } from '@angular/service-worker';
import { environment } from '../environments/environment';
import { TranslatePipe } from './pipes/translate.pipe';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NavbarComponent, FooterComponent, InstallPwaComponent, ChatWidgetComponent, TranslatePipe],
  template: `
    <app-navbar></app-navbar>
    <router-outlet></router-outlet>
    <app-footer></app-footer>
    <app-install-pwa></app-install-pwa>
    <app-chat-widget></app-chat-widget>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  /** One self-recovery per tab, so a reload can never become a loop. */
  private static readonly RECOVERY_FLAG = 'gaadiiq.sw-recovered';

  /** Half an hour: often enough that a deploy lands the same day, rare enough
   *  to be invisible in the network log. */
  private static readonly UPDATE_CHECK_MS = 30 * 60 * 1000;

  private checkTimer?: ReturnType<typeof setInterval>;

  private native = inject(NativeService);
  private swUpdate = inject(SwUpdate);

  /**
   * Take a newly deployed version as soon as the service worker has it.
   *
   * This is a PWA: the service worker prefetches index.html and the JavaScript
   * bundles and serves them from cache, so a browser keeps running whatever
   * version it installed. Nothing here ever listened for a new one, so a
   * deployment reached a returning visitor only by accident — they saw the old
   * app indefinitely, with no sign that a newer one existed.
   *
   * That failure is invisible and looks like a broken feature: a car uploaded,
   * priced and returned by the API simply is not on the page, because the page
   * being run predates the code that asks for it.
   *
   * Reloading only on VERSION_READY means the new files are already cached, so
   * the reload is instant and cannot land on a half-fetched version. A tab
   * mid-form is not interrupted: the reload happens on the next navigation the
   * router performs, not underneath the user.
   */
  private watchForNewVersions(): void {
    if (!this.swUpdate.isEnabled) return;

    this.swUpdate.versionUpdates.subscribe(event => {
      if (event.type === 'VERSION_INSTALLATION_FAILED') {
        // The new version could not be cached — typically because the fetch of
        // a hashed bundle 404'd. The worker stays on the old manifest, whose
        // files the deploy has already deleted, so it is now serving from a
        // cache it cannot refill. Same dead end as `unrecoverable`, reached a
        // step earlier, and the same recovery.
        this.recoverFromBrokenCache();
        return;
      }
      if (event.type !== 'VERSION_READY') return;
      // activateUpdate swaps the cached version; the reload then runs it.
      this.swUpdate.activateUpdate().then(() => this.reloadPage());
    });
  }

  /**
   * Recover from a cache the worker can no longer repair.
   *
   * THIS IS THE HARD-REFRESH BUG.
   *
   * Vercel serves content-hashed bundles and removes the previous build's
   * files on deploy. A tab that installed build A holds a service-worker
   * manifest naming A's hashes. When it later needs a file it did not
   * prefetch — a lazy route chunk, or anything under the lazy `assets`
   * group such as /assets/brand-logos/*.svg — it goes to the network, gets
   * a 404 from a build that no longer exists, and ngsw declares the client
   * UNRECOVERABLE.
   *
   * From then on the worker will not serve and cannot repair itself. That is
   * what the two reports were: brand logos rendering as empty placeholders,
   * and "the catalogue is unreachable" on a car page whose API calls route
   * through the `api-catalogue` dataGroup. Nothing was wrong with the API or
   * the images.
   *
   * Nothing subscribed to `unrecoverable`, so the app had no way out, and a
   * hard refresh worked only because it bypasses the worker entirely. That
   * is why it kept coming back after every deploy, and why "hard refresh"
   * was never a fix — it is the user manually performing the recovery the
   * app should perform itself.
   *
   * A plain reload does NOT help: the same broken worker answers it. The
   * registration has to go first, and its caches with it, so the reload is
   * served by the network and installs a clean worker.
   */
  private watchForBrokenCache(): void {
    if (!this.swUpdate.isEnabled) return;
    this.swUpdate.unrecoverable.subscribe(() => this.recoverFromBrokenCache());
  }

  private recoverFromBrokenCache(): void {
    // Once per tab. If the reload somehow lands in the same state, looping
    // would be worse than the bug — better a still-broken page than one that
    // reloads forever and can never be read or reported.
    try {
      if (sessionStorage.getItem(AppComponent.RECOVERY_FLAG)) return;
      sessionStorage.setItem(AppComponent.RECOVERY_FLAG, '1');
    } catch {
      // Private mode / storage disabled. Proceed: recovering once without the
      // guard beats leaving the app dead.
    }

    this.unregisterServiceWorker()
      .catch(() => { /* recovery is best-effort; reload regardless */ })
      .then(() => this.reloadPage());
  }

  /** Overridable seam: tests must not tear down the runner's own worker. */
  async unregisterServiceWorker(): Promise<void> {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      // ngsw namespaces its caches; leave anything else alone.
      await Promise.all(
        keys.filter(k => k.startsWith('ngsw:')).map(k => caches.delete(k)),
      );
    }
  }

  /**
   * Ask for a new version on a timer.
   *
   * The worker checks on registration and little else, so a tab left open —
   * a phone that never closes it, a desktop tab that lives for days — can sit
   * on a build for as long as it stays open. The check is cheap (one
   * conditional request for ngsw.json) and is what turns a deploy into a
   * VERSION_READY the block above already knows how to take.
   */
  private pollForNewVersions(): void {
    if (!this.swUpdate.isEnabled) return;
    this.checkTimer = setInterval(
      () => this.swUpdate.checkForUpdate().catch(() => { /* offline; try again later */ }),
      AppComponent.UPDATE_CHECK_MS,
    );
  }

  /** Overridable seam: a test that really reloaded would take its runner with it. */
  reloadPage(): void {
    document.location.reload();
  }

  ngOnDestroy() {
    if (this.checkTimer !== undefined) clearInterval(this.checkTimer);
  }

  ngOnInit() {
    this.watchForNewVersions();
    this.watchForBrokenCache();
    this.pollForNewVersions();

    if (this.native.isNative) {
      // Register for push notifications (MOB-015), when there is a Firebase
      // configuration to register against.
      //
      // The .catch() below is not the guard it looks like. Without
      // google-services.json, PushNotifications.register() throws
      // IllegalStateException inside the native plugin, on Android's own
      // Handler thread — the process dies before the promise can reject. The
      // installed debug APK crashed on every launch, before drawing a frame:
      //
      //   java.lang.IllegalStateException: Default FirebaseApp is not
      //   initialized in this process com.gaadiiq.app
      //   at com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin.register
      //
      // So the call has to be avoided rather than caught. The flag goes on in
      // the same change that adds google-services.json.
      if (environment.pushEnabled) {
        this.native.registerPush().catch(() => { /* non-fatal once configured */ });
      }

      // Root/jailbreak detection (MOB-037)
      this.native.isRootedOrJailbroken().then(rooted => {
        if (rooted) {
          console.warn('[security] Rooted/jailbroken device detected. App may not function correctly.');
        }
      });
    }
  }
}
