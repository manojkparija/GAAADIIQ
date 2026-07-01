import { Component, HostListener, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, CommonModule],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss'
})
export class NavbarComponent {
  scrolled = signal(false);
  menuOpen = signal(false);
  userMenuOpen = signal(false);

  constructor(public auth: AuthService) {}

  @HostListener('window:scroll')
  onScroll() { this.scrolled.set(window.scrollY > 30); }

  toggleMenu() { this.menuOpen.update(v => !v); }
  closeMenu() { this.menuOpen.set(false); }
  toggleUserMenu() { this.userMenuOpen.update(v => !v); }

  logout() {
    this.userMenuOpen.set(false);
    this.auth.logout();
  }
}
