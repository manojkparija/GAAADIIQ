import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminBrand, BrandLogoService, LogoOrigin } from '../../services/brand-logo.service';
import { BrandsService } from '../../services/brands.service';
import { AuthService } from '../../services/auth.service';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { IconComponent } from '../../components/icon/icon.component';

@Component({
  selector: 'app-admin-brands',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent],
  templateUrl: './admin-brands.component.html',
  styleUrl: './admin-brands.component.scss',
})
export class AdminBrandsComponent implements OnInit {
  private svc = inject(BrandLogoService);
  private brandsService = inject(BrandsService);
  private auth = inject(AuthService);

  brands = signal<AdminBrand[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);

  /** id of the row currently uploading, so only its tile shows a spinner. */
  busyId = signal<number | null>(null);

  /** Per-row outcome, keyed by brand id — a page-level banner cannot say which row. */
  rowMessage = signal<Record<number, string>>({});
  rowError = signal<Record<number, string>>({});

  /** The URL box, open for one row at a time. */
  urlEditingId = signal<number | null>(null);
  urlDraft = '';

  readonly acceptAttr = this.svc.acceptAttr;

  async ngOnInit() {
    await this.refresh();
  }

  async refresh() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.brands.set(await this.svc.list());
    } catch (e) {
      this.error.set(
        `Could not load brands: ${(e as Error).message}. ` +
        `If this says the table is not readable, migration 013 has not been run yet.`,
      );
    } finally {
      this.loading.set(false);
    }
  }

  origin(b: AdminBrand): LogoOrigin {
    return this.svc.origin(b);
  }

  /**
   * A method, not a computed.
   *
   * `computed()` tracks signal reads only, and this reads the brand argument —
   * a plain object. A computed here would evaluate once and then report that
   * first answer forever, which is a mistake this codebase has shipped twice.
   */
  originLabel(b: AdminBrand): string {
    switch (this.origin(b)) {
      case 'uploaded': return 'Uploaded';
      case 'cdn':      return 'External CDN';
      case 'bundled':  return 'Shipped with the app';
      default:         return 'No logo';
    }
  }

  originHint(b: AdminBrand): string {
    switch (this.origin(b)) {
      case 'uploaded':
        return 'Stored in the brand-logos bucket. Replacing it here takes effect immediately.';
      case 'cdn':
        return 'Served from a third-party CDN. It renders only while that CDN is reachable, and we do not control what it returns.';
      case 'bundled':
        return 'A file committed to the repository. Changing it needs a deploy, which is what uploading here avoids.';
      default:
        return 'This brand has no logo, so its tile renders empty.';
    }
  }

  async onFile(brand: AdminBrand, input: HTMLInputElement) {
    const file = input.files?.[0];
    // Clear immediately: without this, picking the same file twice in a row
    // fires no change event and looks like the upload silently did nothing.
    input.value = '';
    if (!file) return;

    this.setRowError(brand.id, '');
    this.setRowMessage(brand.id, '');

    const reason = this.svc.rejectionReason(file);
    if (reason) {
      this.setRowError(brand.id, reason);
      return;
    }

    this.busyId.set(brand.id);
    try {
      const updated = await this.svc.uploadLogo(brand, file, this.auth.currentUser()?.email ?? null);
      this.brands.update(list => list.map(b => (b.id === updated.id ? updated : b)));
      this.setRowMessage(brand.id, 'Logo updated.');
      // The homepage grid reads a separate cached signal; without this the
      // admin navigates back and sees the old logo.
      await this.brandsService.reload();
    } catch (e) {
      this.setRowError(brand.id, (e as Error).message);
    } finally {
      this.busyId.set(null);
    }
  }

  openUrl(brand: AdminBrand) {
    this.urlEditingId.set(brand.id);
    this.urlDraft = brand.logo_url ?? '';
  }

  cancelUrl() {
    this.urlEditingId.set(null);
    this.urlDraft = '';
  }

  async saveUrl(brand: AdminBrand) {
    this.setRowError(brand.id, '');
    this.busyId.set(brand.id);
    try {
      const updated = await this.svc.setLogoUrl(brand, this.urlDraft, this.auth.currentUser()?.email ?? null);
      this.brands.update(list => list.map(b => (b.id === updated.id ? updated : b)));
      this.setRowMessage(brand.id, 'Logo URL saved.');
      this.cancelUrl();
      await this.brandsService.reload();
    } catch (e) {
      this.setRowError(brand.id, (e as Error).message);
    } finally {
      this.busyId.set(null);
    }
  }

  async toggleActive(brand: AdminBrand) {
    this.setRowError(brand.id, '');
    this.busyId.set(brand.id);
    try {
      const updated = await this.svc.setActive(brand, !brand.active);
      this.brands.update(list => list.map(b => (b.id === updated.id ? updated : b)));
      await this.brandsService.reload();
    } catch (e) {
      this.setRowError(brand.id, (e as Error).message);
    } finally {
      this.busyId.set(null);
    }
  }

  /** Broken image, or none at all — the tile shows the initial rather than nothing. */
  initial(b: AdminBrand): string {
    return (b.name || '?').trim().charAt(0).toUpperCase();
  }

  onImgError(event: Event) {
    (event.target as HTMLImageElement).style.display = 'none';
  }

  private setRowMessage(id: number, text: string) {
    this.rowMessage.update(m => ({ ...m, [id]: text }));
  }

  private setRowError(id: number, text: string) {
    this.rowError.update(m => ({ ...m, [id]: text }));
  }
}
