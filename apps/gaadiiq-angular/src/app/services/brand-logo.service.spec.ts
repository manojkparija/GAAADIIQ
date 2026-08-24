import { TestBed } from '@angular/core/testing';
import { BrandLogoService } from './brand-logo.service';
import { SupabaseService } from './supabase.service';

describe('BrandLogoService', () => {
  let svc: BrandLogoService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseService, useValue: { client: {} } }],
    });
    svc = TestBed.inject(BrandLogoService);
  });

  describe('origin', () => {
    /**
     * The bug this exists for.
     *
     * The bundled logos live in `assets/brand-logos/`, and the storage bucket is
     * called `brand-logos` — the same word. Matching on the bucket name alone
     * reported every repo asset as "Uploaded", so the screen claimed the one
     * logo that actually needs a deploy to change could be replaced from the
     * admin page. Mahindra is exactly that row: migration 004 put it back on a
     * repo file on purpose.
     */
    it('calls a bundled assets path bundled, not uploaded', () => {
      expect(svc.origin({ logo_url: 'assets/brand-logos/mahindra.svg' })).toBe('bundled');
    });

    it('calls a storage object uploaded', () => {
      expect(
        svc.origin({
          logo_url: 'https://abc.supabase.co/storage/v1/object/public/brand-logos/tata-1.svg',
        }),
      ).toBe('uploaded');
    });

    it('calls any other absolute URL a CDN', () => {
      expect(svc.origin({ logo_url: 'https://cdn.jsdelivr.net/gh/x/logos/kia.png' })).toBe('cdn');
    });

    it('reports a missing logo rather than guessing', () => {
      expect(svc.origin({ logo_url: null })).toBe('none');
      expect(svc.origin({ logo_url: '' })).toBe('none');
    });
  });

  describe('rejectionReason', () => {
    const file = (name: string, type: string, size: number) =>
      ({ name, type, size }) as File;

    it('accepts SVG, PNG and WebP', () => {
      expect(svc.rejectionReason(file('t.svg', 'image/svg+xml', 2000))).toBeNull();
      expect(svc.rejectionReason(file('t.png', 'image/png', 2000))).toBeNull();
      expect(svc.rejectionReason(file('t.webp', 'image/webp', 2000))).toBeNull();
    });

    /**
     * JPEG has no alpha channel, so it renders as a white or black square inside
     * the circular tile. It looks like a broken layout rather than a wrong file,
     * which is why the reason says so instead of just "unsupported".
     */
    it('refuses JPEG, and says why', () => {
      const reason = svc.rejectionReason(file('t.jpg', 'image/jpeg', 2000));
      expect(reason).toContain('transparency');
    });

    it('refuses a file over the size cap', () => {
      expect(svc.rejectionReason(file('t.png', 'image/png', 900 * 1024))).toContain('KB');
    });

    it('refuses an empty file', () => {
      expect(svc.rejectionReason(file('t.svg', 'image/svg+xml', 0))).toBe('That file is empty.');
    });

    /** Some file pickers report no MIME type for .svg; the name is the fallback. */
    it('accepts an SVG whose type the browser did not report', () => {
      expect(svc.rejectionReason(file('tata.svg', '', 1000))).toBeNull();
    });
  });

  describe('solidBackgroundColour', () => {
    /**
     * Build a real PNG so the check is exercised through canvas decoding rather
     * than against a stub of it. `background` null means transparent.
     */
    const png = async (background: string | null): Promise<File> => {
      const c = document.createElement('canvas');
      c.width = 40; c.height = 40;
      const ctx = c.getContext('2d')!;
      if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, 40, 40); }
      // A mark in the middle either way, so the two cases differ only in the
      // background — which is the thing under test.
      ctx.fillStyle = '#d0021b';
      ctx.fillRect(12, 12, 16, 16);
      const blob: Blob = await new Promise(r => c.toBlob(b => r(b!), 'image/png'));
      return new File([blob], 'logo.png', { type: 'image/png' });
    };

    /**
     * The case that shipped: the first logo uploaded through this screen was a
     * PNG on white, and it rendered as a white square inside the round tile.
     * Nothing about the file is invalid, so format and size checks pass it.
     */
    it('reports a white background', async () => {
      expect(await svc.solidBackgroundColour(await png('#ffffff'))).toBe('rgb(255, 255, 255)');
    });

    it('reports a coloured background too, not just white', async () => {
      expect(await svc.solidBackgroundColour(await png('#000000'))).toBe('rgb(0, 0, 0)');
    });

    it('passes a transparent logo', async () => {
      expect(await svc.solidBackgroundColour(await png(null))).toBeNull();
    });

    /** A file the browser cannot decode must not become a refusal to upload. */
    it('says nothing when the image cannot be examined', async () => {
      const bad = new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' });
      expect(await svc.solidBackgroundColour(bad)).toBeNull();
    });
  });
});
