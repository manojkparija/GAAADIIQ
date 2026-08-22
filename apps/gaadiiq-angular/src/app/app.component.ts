import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavbarComponent } from './components/navbar/navbar.component';
import { FooterComponent } from './components/footer/footer.component';
import { InstallPwaComponent } from './components/install-pwa/install-pwa.component';
import { ChatWidgetComponent } from './components/chat-widget/chat-widget.component';
import { NativeService } from './services/native.service';
import { SwUpdate } from '@angular/service-worker';
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
export class AppComponent implements OnInit {
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
      if (event.type !== 'VERSION_READY') return;
      // activateUpdate swaps the cached version; the reload then runs it.
      this.swUpdate.activateUpdate().then(() => this.reloadPage());
    });
  }

  /** Overridable seam: a test that really reloaded would take its runner with it. */
  reloadPage(): void {
    document.location.reload();
  }

  ngOnInit() {
    this.watchForNewVersions();

    if (this.native.isNative) {
      // Register for push notifications (MOB-015)
      this.native.registerPush().catch(() => { /* non-fatal */ });

      // Root/jailbreak detection (MOB-037)
      this.native.isRootedOrJailbroken().then(rooted => {
        if (rooted) {
          console.warn('[security] Rooted/jailbroken device detected. App may not function correctly.');
        }
      });
    }
  }
}
