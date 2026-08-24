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

  describe('cleanUp', () => {
    /** Draw onto a canvas and hand back a real PNG File. */
    const make = async (
      w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void,
    ): Promise<File> => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      draw(c.getContext('2d')!);
      const blob: Blob = await new Promise(r => c.toBlob(b => r(b!), 'image/png'));
      return new File([blob], 'logo.png', { type: 'image/png' });
    };

    /** Read a File back into pixels so the result can be asserted on. */
    const pixels = async (file: File) => {
      const url = URL.createObjectURL(file);
      try {
        const img: HTMLImageElement = await new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i); i.onerror = rej; i.src = url;
        });
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        return {
          width: c.width,
          height: c.height,
          at: (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data),
        };
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    it('removes a solid background and trims the empty margin', async () => {
      // A small mark adrift in a wide frame — the shape of the file that
      // prompted this, where object-fit: contain rendered the mark tiny.
      const file = await make(200, 100, ctx => {
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 200, 100);
        ctx.fillStyle = '#d0021b'; ctx.fillRect(90, 40, 20, 20);
      });

      const cleaned = await svc.cleanUp(file);
      expect(cleaned.changed).toBe(true);

      const p = await pixels(cleaned.file);
      // Trimmed to the mark plus a small pad, not the original 200x100.
      expect(p.width).toBeLessThan(40);
      expect(p.height).toBeLessThan(40);
      // Corner is now transparent; the mark survived.
      expect(p.at(0, 0)[3]).toBe(0);
      expect(p.at(Math.floor(p.width / 2), Math.floor(p.height / 2))[3]).toBeGreaterThan(250);
    });

    /**
     * The case that separates a flood fill from "delete every white pixel".
     *
     * Plenty of marks have white inside them — a counter, a gap, a highlight.
     * Replacing by colour would punch holes straight through the artwork, and
     * the result would look deliberate enough to ship.
     */
    it('keeps white that is inside the mark', async () => {
      const file = await make(100, 100, ctx => {
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 100, 100);
        ctx.fillStyle = '#000000'; ctx.fillRect(20, 20, 60, 60);   // mark
        ctx.fillStyle = '#ffffff'; ctx.fillRect(45, 45, 10, 10);   // hole inside it
      });

      const cleaned = await svc.cleanUp(file);
      const p = await pixels(cleaned.file);

      const mid = Math.floor(p.width / 2);
      // The enclosed white is not connected to the edge, so it stays opaque.
      expect(p.at(mid, mid)[3]).toBeGreaterThan(250);
      expect(p.at(mid, mid).slice(0, 3)).toEqual([255, 255, 255]);
    });

    /**
     * The bug that shipped and came back from production.
     *
     * A product render is lit, so its ground is not flat: black at the edges,
     * lifting to a soft glow behind the subject. The first version compared
     * every pixel against the CORNER colour, so the fill stopped the moment the
     * vignette drifted past its tolerance and left a wide dark halo — a black
     * rectangle by another name. Measured before the fix: a 60x60 mark came back
     * as 243x232, still 69% opaque.
     *
     * The numbers below are the point of the test. Asserting only "some pixels
     * were cleared" passes on the broken version too.
     */
    it('follows a vignetted background all the way in', async () => {
      const W = 400, H = 214;
      const file = await make(W, H, ctx => {
        const g = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W / 2);
        g.addColorStop(0, '#464646');   // glow behind the mark
        g.addColorStop(1, '#000000');   // black at the corners
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#c8c8c8'; ctx.fillRect(170, 80, 60, 60);
      });

      const cleaned = await svc.cleanUp(file);
      expect(cleaned.changed).toBe(true);

      const p = await pixels(cleaned.file);
      // Trimmed to the mark plus its small pad, not to the halo.
      expect(p.width).toBeLessThan(80);
      expect(p.height).toBeLessThan(80);
      expect(p.at(0, 0)[3]).toBe(0);
    });

    /**
     * The guard that stops the gradient-following fill from eating the artwork.
     * A mark that fades into its own shadow has small steps all the way up, so
     * only the cap on total deviation from the seed colour stops the crawl.
     */
    it('does not crawl up a soft edge into the mark', async () => {
      const file = await make(120, 120, ctx => {
        ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 120, 120);
        // A mark with a wide soft halo around it, black through to near-white.
        const g = ctx.createRadialGradient(60, 60, 6, 60, 60, 55);
        g.addColorStop(0, '#f0f0f0');
        g.addColorStop(1, '#000000');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(60, 60, 55, 0, Math.PI * 2); ctx.fill();
      });

      const cleaned = await svc.cleanUp(file);
      const p = await pixels(cleaned.file);
      // The bright core must survive; a runaway fill would have cleared it.
      expect(p.at(Math.floor(p.width / 2), Math.floor(p.height / 2))[3]).toBeGreaterThan(250);
    });

    /**
     * The one that reached production as "logo has to be in the centre".
     *
     * The uploaded render carried a small sparkle in its bottom-right corner.
     * The fill correctly left it alone — it is not background — so the trim box
     * spanned the mark AND the sparkle, and the mark landed in the top-left of
     * the tile at half size with a dot opposite it. The centring was never
     * wrong; the box was.
     */
    it('ignores a stray speck when deciding where to trim', async () => {
      const file = await make(400, 214, ctx => {
        ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 400, 214);
        ctx.fillStyle = '#c8c8c8'; ctx.fillRect(80, 60, 70, 70);   // the mark
        ctx.fillRect(384, 200, 4, 4);                              // the sparkle
      });

      const cleaned = await svc.cleanUp(file);
      const p = await pixels(cleaned.file);

      // Without the prune this is ~310x150 — the box out to the corner.
      expect(p.width).toBeLessThan(90);
      expect(p.height).toBeLessThan(90);

      // And the mark is centred in what remains, rather than pinned to a corner.
      const cx = Math.floor(p.width / 2), cy = Math.floor(p.height / 2);
      expect(p.at(cx, cy)[3]).toBeGreaterThan(250);
    });

    /** A mark in genuinely separate pieces must survive intact. */
    it('keeps every piece of a multi-part mark', async () => {
      const file = await make(200, 120, ctx => {
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 200, 120);
        ctx.fillStyle = '#295EE0';
        ctx.fillRect(40, 40, 40, 40);    // left wing
        ctx.fillRect(120, 40, 40, 40);   // right wing, not touching
      });

      const cleaned = await svc.cleanUp(file);
      const p = await pixels(cleaned.file);

      // Both pieces are inside the box, so it spans them: wider than one alone.
      expect(p.width).toBeGreaterThan(110);
      // Left and right both still painted.
      expect(p.at(Math.floor(p.width * 0.15), Math.floor(p.height / 2))[3]).toBeGreaterThan(250);
      expect(p.at(Math.floor(p.width * 0.85), Math.floor(p.height / 2))[3]).toBeGreaterThan(250);
    });

    it('leaves a logo that is already transparent and tight alone', async () => {
      const file = await make(60, 60, ctx => {
        ctx.fillStyle = '#14B8A6'; ctx.fillRect(0, 0, 60, 60);
      });
      // Nothing connected to the edge differs from the corner, but the artwork
      // fills the frame — there is nothing to remove and nothing to trim.
      expect((await svc.cleanUp(file)).changed).toBe(false);
    });

    it('refuses to return an empty tile when everything matched', async () => {
      const file = await make(50, 50, ctx => {
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 50, 50);
      });
      expect((await svc.cleanUp(file)).changed).toBe(false);
    });

    it('returns null rather than throwing on a file it cannot decode', async () => {
      const bad = new File([new Uint8Array([9, 9, 9])], 'x.png', { type: 'image/png' });
      const r = await svc.cleanUp(bad);
      expect(r.changed).toBe(false);
      expect(r.file).toBe(bad);   // the original, so the upload still goes ahead
    });
  });
});
