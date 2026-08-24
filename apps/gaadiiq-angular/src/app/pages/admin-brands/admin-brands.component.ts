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
      // Fix the file rather than send the admin away to fix it.
      //
      // This was a warning first — "use a version with a transparent
      // background" — and the warning did not help, because the person reading
      // it has the logo they want and no image editor to hand. Both faults are
      // mechanical: a backdrop, and a wide empty margin around a small mark.
      // The browser can remove them, and the uploaded artwork is still the real
      // logo rather than a redrawn one.
      // No gate in front of it.
      //
      // This used to run only when solidBackgroundColour() reported a backdrop,
      // and a file with a visibly black background came through that gate with
      // nothing found — so the cleanup never ran and the tile stayed a black
      // rectangle. Two conditions had to agree before anything happened, and
      // the stricter one silently won.
      //
      // cleanUp is conservative on its own: when there is nothing connected to
      // the edge to remove it returns the ORIGINAL file, so a healthy logo is
      // uploaded byte-for-byte and a healthy SVG stays an SVG. The gate was
      // adding a way to fail, not a safeguard.
      const clean = await this.svc.cleanUp(file);

      // Report either way. A silent "Logo updated." after a tile comes out
      // wrong gives nobody — admin or maintainer — anything to go on; that is
      // exactly how the black rectangle above went unexplained.
      const note = clean.changed
        ? ` Background removed and trimmed ${clean.from} to ${clean.to}.`
        : ` No background found to remove${clean.from ? ` (${clean.from})` : ''}; uploaded unchanged.`;

      const updated = await this.svc.uploadLogo(brand, clean.file, this.auth.currentUser()?.email ?? null);
      this.brands.update(list => list.map(b => (b.id === updated.id ? updated : b)));
      this.setRowMessage(brand.id, `Logo updated.${note}`);
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

  /** Brand ids whose logo failed to load, so the initial takes over for those. */
  private broken = signal<Set<number>>(new Set());

  /**
   * Is a logo actually on screen for this row?
   *
   * A method, not a computed: it takes the brand as an argument and reads a
   * plain field on it, and a computed over a non-signal evaluates once and then
   * reports that first answer forever.
   */
  showsImage(b: AdminBrand): boolean {
    return !!b.logo_url && !this.broken().has(b.id);
  }

  onImgError(b: AdminBrand, event: Event) {
    (event.target as HTMLImageElement).style.display = 'none';
    this.broken.update(s => new Set(s).add(b.id));
  }

  onImgLoad(b: AdminBrand) {
    // A replaced logo that now loads must clear the flag, or the tile keeps
    // showing the letter after a successful re-upload.
    if (this.broken().has(b.id)) {
      this.broken.update(s => {
        const next = new Set(s);
        next.delete(b.id);
        return next;
      });
    }
  }

  private setRowMessage(id: number, text: string) {
    this.rowMessage.update(m => ({ ...m, [id]: text }));
  }

  private setRowError(id: number, text: string) {
    this.rowError.update(m => ({ ...m, [id]: text }));
  }
}
