/**
 * Step 3 — review the trim prices after a New Cars upload.
 *
 * Requested repeatedly: after the metadata step, the LLM should fetch this
 * model's prices and let the admin edit them before anything reaches the
 * dashboard. Everything the panel needs already existed on the API — research,
 * list, patch — so this exercises the wiring, which is where the mistakes are.
 *
 * NOTE ON NgModel, which has produced a false result in this repo before:
 * NgModel writes to the DOM in a deferred microtask, so detectChanges() alone
 * leaves an input empty however correct the binding is. `whenStable()` is what
 * makes a DOM assertion here mean anything.
 */
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { AdminCarImagesComponent } from './admin-car-images.component';
import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';

describe('admin-car-images — step 3 trim pricing', () => {
  let fixture: ComponentFixture<AdminCarImagesComponent>;
  let comp: AdminCarImagesComponent;

  const trims = [
    { id: 'v1', car_id: 'c1', name: 'Sigma', ex_showroom_price: 650000, status: 'draft', source: 'ai', sort_order: 0, features: [] },
    { id: 'v2', car_id: 'c1', name: 'Alpha', ex_showroom_price: 1150000, status: 'draft', source: 'ai', sort_order: 1, features: [] },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminCarImagesComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { isAdmin: () => true, currentUser: signal({ email: 'a@b.c', name: 'A' }) } },
        { provide: SupabaseService, useValue: { client: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } } } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminCarImagesComponent);
    comp = fixture.componentInstance;
  });

  it('renders each researched trim with its price', async () => {
    comp.pricingCarId.set('c1');
    comp.inPricingStep.set(true);
    comp.pricingVehicle.set('Maruti Suzuki Fronx 2026');
    comp.pricingTrims.set(trims.map(t => ({
      id: t.id, name: t.name, price: t.ex_showroom_price,
      status: t.status, source: t.source, dirty: false,
    })));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Step 3');
    expect(text).toContain('Maruti Suzuki Fronx 2026');
    expect(text).toContain('Sigma');
    expect(text).toContain('Alpha');

    // The prices must actually be in the inputs — the panel rendering with
    // empty boxes would look identical in a screenshot.
    const inputs: HTMLInputElement[] =
      Array.from(fixture.nativeElement.querySelectorAll('input.aci-trim-price'));
    expect(inputs.length).toBe(2);
    expect(inputs.map(i => i.value).sort()).toEqual(['1150000', '650000']);
  });

  it('marks a trim dirty when its price is edited, and only then offers Save', async () => {
    comp.pricingCarId.set('c1');
    comp.inPricingStep.set(true);
    comp.pricingTrims.set([{
      id: 'v1', name: 'Sigma', price: 650000,
      status: 'draft', source: 'ai', dirty: false,
    }]);
    fixture.detectChanges();

    // Save is meaningless until something changed, and an always-enabled Save
    // invites writing a researched figure back as though it were vouched for.
    let save = Array.from(
      fixture.nativeElement.querySelectorAll('button')
    ).find((b: any) => b.textContent?.trim() === 'Save') as HTMLButtonElement;
    expect(save.disabled).withContext('Save enabled before any edit').toBe(true);

    comp.setTrimPrice('v1', 699000);
    fixture.detectChanges();

    expect(comp.pricingTrims()[0].price).toBe(699000);
    expect(comp.pricingTrims()[0].dirty).toBe(true);
    expect(comp.unsavedTrims()).toBe(1);

    save = Array.from(
      fixture.nativeElement.querySelectorAll('button')
    ).find((b: any) => b.textContent?.trim() === 'Save') as HTMLButtonElement;
    expect(save.disabled).withContext('Save still disabled after an edit').toBe(false);
  });

  it('clears a price to null rather than storing NaN', () => {
    comp.pricingCarId.set('c1');
    comp.pricingTrims.set([{
      id: 'v1', name: 'Sigma', price: 650000,
      status: 'draft', source: 'ai', dirty: false,
    }]);

    comp.setTrimPrice('v1', '');
    expect(comp.pricingTrims()[0].price).toBeNull();

    // A number input can hand over unparseable text; NaN must not reach the API
    // as a price.
    comp.setTrimPrice('v1', 'abc');
    expect(comp.pricingTrims()[0].price).toBeNull();
  });

  it('refuses to publish a trim with no price', async () => {
    comp.pricingCarId.set('c1');
    comp.pricingTrims.set([{
      id: 'v1', name: 'Sigma', price: null,
      status: 'draft', source: 'ai', dirty: false,
    }]);

    await comp.publishTrim(comp.pricingTrims()[0]);

    expect(comp.pricingError()).toContain('no price');
  });

  it('sends the edited price with the publish, not the researched one', async () => {
    const calls: { url: string; body: any }[] = [];
    spyOn(window, 'fetch').and.callFake(async (url: any, init: any) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
      return new Response(
        JSON.stringify({ id: 'v1', name: 'Sigma', ex_showroom_price: 699000, status: 'published', source: 'ai' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ) as any;
    });

    comp.pricingCarId.set('c1');
    comp.pricingTrims.set([{
      id: 'v1', name: 'Sigma', price: 650000,
      status: 'draft', source: 'ai', dirty: false,
    }]);

    comp.setTrimPrice('v1', 699000);
    await comp.publishTrim(comp.pricingTrims()[0]);

    expect(calls.length).toBe(1);
    expect(calls[0].url).toContain('/cars/c1/variants/v1');
    // Publishing while an edited price sat unsaved would put the AI's figure
    // in front of buyers — the exact outcome this step exists to prevent.
    expect(calls[0].body.ex_showroom_price).toBe('699000');
    expect(calls[0].body.status).toBe('published');

    expect(comp.pricingTrims()[0].status).toBe('published');
    expect(comp.pricingTrims()[0].dirty).toBe(false);
  });

  it('is not shown at all before the admin reaches the metadata step', () => {
    fixture.detectChanges();
    expect(comp.inPricingStep()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Step 3');
  });

  /**
   * The ordering. First built the other way round — panel after the upload —
   * which is not what was asked for: the prices are to be reviewed *before*
   * the images are committed. These pin the order so it cannot quietly revert.
   */
  describe('runs before the upload, not after', () => {
    beforeEach(() => {
      comp.catalogue.set([
        { make: 'Maruti Suzuki', model: 'Grand Vitara', variant: null, year: 2026, ex_showroom_price: 1099000 },
      ] as any);
      comp.make.set('Maruti Suzuki');
      comp.model.set('Grand Vitara');
      comp.modelYear.set(2026);
      comp.mediaBucket.set('new');
      comp.selectedFiles.set([new File(['x'], 'gv.jpg')]);
      comp.showMetadataGrid.set(true);
    });

    it('offers Review Trim Prices instead of Upload while unreviewed', () => {
      fixture.detectChanges();
      const labels = Array.from(fixture.nativeElement.querySelectorAll('button'))
        .map((b: any) => b.textContent?.trim());
      expect(labels).toContain('→ Review Trim Prices');
      expect(labels.some((l: string) => l?.startsWith('✓ Upload'))).toBe(false);
    });

    it('resolves the catalogue row and researches it, before any upload', async () => {
      const urls: string[] = [];
      spyOn(window, 'fetch').and.callFake(async (url: any) => {
        urls.push(String(url));
        const u = String(url);
        if (u.includes('/catalogue/resolve')) {
          return new Response(JSON.stringify({ car_id: 'car-gv' }), { status: 200 }) as any;
        }
        if (u.includes('/variants/research')) {
          return new Response(JSON.stringify([]), { status: 200 }) as any;
        }
        return new Response(JSON.stringify(trims), { status: 200 }) as any;
      });

      await comp.reviewPricesBeforeUpload();

      expect(urls.some(u => u.includes('/catalogue/resolve'))).toBe(true);
      expect(urls.some(u => u.includes('/variants/research'))).toBe(true);
      // The images must not have been sent yet — that is the whole point.
      expect(urls.some(u => u.includes('/media-admin/upload'))).toBe(false);
      expect(comp.pricingCarId()).toBe('car-gv');
      expect(comp.pricingTrims().length).toBe(2);
    });

    it('shows Upload once the prices have been reviewed', async () => {
      spyOn(window, 'fetch').and.callFake(async (url: any) => {
        const u = String(url);
        if (u.includes('/catalogue/resolve')) {
          return new Response(JSON.stringify({ car_id: 'car-gv' }), { status: 200 }) as any;
        }
        if (u.includes('/variants/research')) {
          return new Response(JSON.stringify([]), { status: 200 }) as any;
        }
        return new Response(JSON.stringify(trims), { status: 200 }) as any;
      });

      await comp.reviewPricesBeforeUpload();
      fixture.detectChanges();

      const labels = Array.from(fixture.nativeElement.querySelectorAll('button'))
        .map((b: any) => b.textContent?.trim());
      expect(labels.some((l: string) => l?.startsWith('✓ Upload'))).toBe(true);
    });

    it('does not trap the admin when the lookup fails', async () => {
      spyOn(window, 'fetch').and.returnValue(Promise.reject(new Error('offline')));

      await comp.reviewPricesBeforeUpload();
      fixture.detectChanges();

      // The images are the job. A pricing lookup failing must still let them
      // be uploaded, with the reason on screen.
      expect(comp.pricingError()).toContain('Could not load trims');
      const labels = Array.from(fixture.nativeElement.querySelectorAll('button'))
        .map((b: any) => b.textContent?.trim());
      expect(labels.some((l: string) => l?.startsWith('✓ Upload'))).toBe(true);
    });

    /**
     * Reported from production: the button read "✓ Upload" with no pricing
     * step at all.
     *
     * canPriceBeforeUpload() required modelIsKnown(), which matches make +
     * model + *year*. The year picker deliberately offers this year and next
     * whether or not the catalogue has reached them — that is how a new launch
     * gets photographed before it is listed. So a 2026 upload against a
     * catalogue holding 2024 and 2025 skipped the step entirely, which is
     * exactly the case researched prices are most wanted for.
     */
    it('offers the step for a model year the catalogue has not reached', () => {
      comp.catalogue.set([
        { make: 'Maruti Suzuki', model: 'Grand Vitara', variant: null, year: 2024, ex_showroom_price: 1050000 },
      ] as any);
      comp.modelYear.set(2026);
      fixture.detectChanges();

      expect(comp.canPriceBeforeUpload())
        .withContext('a year the catalogue lacks must still offer pricing').toBe(true);
      const labels = Array.from(fixture.nativeElement.querySelectorAll('button'))
        .map((b: any) => b.textContent?.trim());
      expect(labels).toContain('→ Review Trim Prices');
    });

    it('offers the step for a model the catalogue has never seen', () => {
      comp.catalogue.set([] as any);
      comp.model.set('Brand New Model');
      fixture.detectChanges();

      expect(comp.canPriceBeforeUpload()).toBe(true);
      const labels = Array.from(fixture.nativeElement.querySelectorAll('button'))
        .map((b: any) => b.textContent?.trim());
      expect(labels).toContain('→ Review Trim Prices');
    });

    it('researches by identity when there is no catalogue row, and saves nothing yet', async () => {
      const calls: { url: string; method: string }[] = [];
      spyOn(window, 'fetch').and.callFake(async (url: any, init: any) => {
        calls.push({ url: String(url), method: init?.method ?? 'GET' });
        if (String(url).includes('/catalogue/resolve')) {
          return new Response(JSON.stringify({ car_id: null }), { status: 200 }) as any;
        }
        return new Response(JSON.stringify([
          { name: 'Sigma', ex_showroom_price: 1099000, features: [] },
        ]), { status: 200 }) as any;
      });

      comp.catalogue.set([] as any);
      comp.model.set('Brand New Model');
      await comp.reviewPricesBeforeUpload();

      expect(calls.some(c => c.url.includes('/catalogue/research-trims'))).toBe(true);
      // Nothing may be written before the upload — there is no row to write to.
      expect(calls.some(c => c.url.includes('/variants') && c.method === 'POST')).toBe(false);
      expect(comp.inPricingStep()).toBe(true);
      expect(comp.pricingTrims().length).toBe(1);
      expect(comp.pricingTrims()[0].pending).toBe(true);
      expect(comp.pricingTrims()[0].price).toBe(1099000);
    });

    it('does not offer Save or Publish on a trim that has nowhere to be saved', async () => {
      comp.pricingTrims.set([{
        id: 'pending-0', name: 'Sigma', price: 1099000,
        status: 'draft', source: 'ai', dirty: false, pending: true,
      }]);
      comp.inPricingStep.set(true);
      fixture.detectChanges();

      const labels = Array.from(fixture.nativeElement.querySelectorAll('button'))
        .map((b: any) => b.textContent?.trim());
      expect(labels).not.toContain('Save');
      expect(labels).not.toContain('Publish');
      expect(fixture.nativeElement.textContent).toContain('Saved when you upload');
    });

    it('does not offer the step for a Used Cars upload', () => {
      comp.mediaBucket.set('used');
      fixture.detectChanges();
      expect(comp.canPriceBeforeUpload()).toBe(false);
    });
  });
});
