import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavbarComponent } from './components/navbar/navbar.component';
import { FooterComponent } from './components/footer/footer.component';
import { InstallPwaComponent } from './components/install-pwa/install-pwa.component';
import { NativeService } from './services/native.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NavbarComponent, FooterComponent, InstallPwaComponent],
  template: `
    <app-navbar></app-navbar>
    <router-outlet></router-outlet>
    <app-footer></app-footer>
    <app-install-pwa></app-install-pwa>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; }
  `]
})
export class AppComponent implements OnInit {
  private native = inject(NativeService);

  ngOnInit() {
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
