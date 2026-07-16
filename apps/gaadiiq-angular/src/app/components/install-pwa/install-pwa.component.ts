import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-install-pwa',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (showBanner()) {
      <div class="pwa-banner">
        <div class="pwa-content">
          <span class="pwa-icon">⚡</span>
          <div class="pwa-text">
            <strong>Install GAADIIQ</strong>
            <span>Add to home screen for a faster experience</span>
          </div>
        </div>
        <div class="pwa-actions">
          <button class="btn-gradient btn-sm" (click)="install()">Install</button>
          <button class="dismiss" (click)="dismiss()">✕</button>
        </div>
      </div>
    }
  `,
  styles: [`
    .pwa-banner {
      position: fixed; bottom: 80px; left: 1rem; right: 1rem; z-index: 1000;
      background: rgba(10,14,26,0.95); backdrop-filter: blur(20px);
      border: 1px solid rgba(108,99,255,0.3); border-radius: 16px;
      padding: 1rem 1.25rem; display: flex; align-items: center; justify-content: space-between;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      animation: slideUp 0.3s ease;
    }
    @media(min-width:768px) {
      .pwa-banner { max-width: 480px; left: auto; right: 1.5rem; bottom: 2rem; }
    }
    @keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    .pwa-content { display: flex; align-items: center; gap: 0.75rem; }
    .pwa-icon { font-size: 1.5rem; }
    .pwa-text { display: flex; flex-direction: column; }
    .pwa-text strong { font-size: 0.9rem; }
    .pwa-text span { font-size: 0.75rem; color: rgba(255,255,255,0.5); }
    .pwa-actions { display: flex; align-items: center; gap: 0.75rem; }
    .dismiss { background: none; border: none; color: rgba(255,255,255,0.4); font-size: 1rem; cursor: pointer; padding: 0.25rem; }
  `]
})
export class InstallPwaComponent implements OnInit {
  showBanner = signal(false);
  private deferredPrompt: any;

  ngOnInit() {
    window.addEventListener('beforeinstallprompt', (e: any) => {
      e.preventDefault();
      this.deferredPrompt = e;
      this.showBanner.set(true);
    });
  }

  install() {
    if (this.deferredPrompt) {
      this.deferredPrompt.prompt();
      this.deferredPrompt.userChoice.then(() => {
        this.deferredPrompt = null;
        this.showBanner.set(false);
      });
    }
  }

  dismiss() { this.showBanner.set(false); }
}
