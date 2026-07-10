import { Component, HostListener, signal, computed } from '@angular/core';
import { RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { ThemeService } from '../../services/theme.service';
import { CityService } from '../../services/city.service';
import { LanguageService } from '../../services/language.service';
import { CitySelectorComponent } from '../city-selector/city-selector.component';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, CommonModule, CitySelectorComponent],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss'
})
export class NavbarComponent {
  private static readonly DARK_HERO_ROUTES = ['/new-cars', '/used-cars'];
  private _scrolled = signal(false);
  private _darkHero = signal(false);
  scrolled = computed(() => this._scrolled() || this._darkHero());

  menuOpen = signal(false);
  userMenuOpen = signal(false);
  cityModalOpen = signal(false);

  constructor(
    public auth: AuthService,
    public theme: ThemeService,
    public city: CityService,
    public lang: LanguageService,
    router: Router
  ) {
    router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe((e: any) => {
      this._darkHero.set(NavbarComponent.DARK_HERO_ROUTES.some(r => e.urlAfterRedirects?.startsWith(r)));
    });
  }

  @HostListener('window:scroll')
  onScroll() { this._scrolled.set(window.scrollY > 30); }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (this.userMenuOpen() && !target.closest('.user-menu-wrap')) {
      this.userMenuOpen.set(false);
    }
  }

  toggleMenu() { this.menuOpen.update(v => !v); }
  closeMenu() { this.menuOpen.set(false); }
  toggleUserMenu() { this.userMenuOpen.update(v => !v); }
  openCityModal() { this.cityModalOpen.set(true); }
  closeCityModal() { this.cityModalOpen.set(false); }

  logout() {
    this.userMenuOpen.set(false);
    this.auth.logout();
  }
}
