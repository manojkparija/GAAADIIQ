import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavbarComponent } from './components/navbar/navbar.component';
import { FooterComponent } from './components/footer/footer.component';
import { InstallPwaComponent } from './components/install-pwa/install-pwa.component';

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
export class AppComponent {}
