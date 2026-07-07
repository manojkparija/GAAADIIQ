import { Component, HostListener, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, Router, NavigationStart } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { CityService } from '../../services/city.service';
import { LanguageService } from '../../services/language.service';
import { CitySelectorComponent } from '../city-selector/city-selector.component';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, CommonModule, CitySelectorComponent],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss'
})
export class NavbarComponent {
  scrolled     = signal(false);
  menuOpen     = signal(false);
  userMenuOpen = signal(false);
  cityModalOpen = signal(false);
  activeMega   = signal<'new' | 'used' | null>(null);

  constructor(
    public auth: AuthService, public theme: ThemeService,
    public city: CityService, public lang: LanguageService,
    router: Router
  ) {
    router.events.subscribe(e => { if (e instanceof NavigationStart) this.closeMega(); });
  }

  @HostListener('window:scroll')
  onScroll() { this.scrolled.set(window.scrollY > 30); }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (this.userMenuOpen() && !target.closest('.user-menu-wrap')) {
      this.userMenuOpen.set(false);
    }
  }

  openMega(m: 'new' | 'used') { this.activeMega.set(m); }
  closeMega() { this.activeMega.set(null); }

  toggleMenu() { this.menuOpen.update(v => !v); }
  closeMenu() { this.menuOpen.set(false); this.closeMega(); }
  toggleUserMenu() { this.userMenuOpen.update(v => !v); }
  openCityModal() { this.cityModalOpen.set(true); }
  closeCityModal() { this.cityModalOpen.set(false); }

  logout() {
    this.userMenuOpen.set(false);
    this.auth.logout();
  }
}
