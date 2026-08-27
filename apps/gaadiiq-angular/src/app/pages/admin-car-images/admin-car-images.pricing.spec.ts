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

  it('is not shown at all before an upload has happened', () => {
    fixture.detectChanges();
    expect(comp.inPricingStep()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Step 3');
  });
});
