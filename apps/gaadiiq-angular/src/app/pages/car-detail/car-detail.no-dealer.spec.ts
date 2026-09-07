/**
 * What happens when no dealer is onboarded yet.
 *
 * This is the go-live case, and it is the one that has to work: the catalogue
 * is loaded, buyers arrive, and there is nobody but the business itself to
 * answer them. These tests walk that path so it does not have to be clicked
 * through by hand.
 *
 * WHAT WAS ACTUALLY HAPPENING
 *
 * Reported from the live site with a screenshot: a dealer card for "Rajesh
 * Kumar, RK Motors, Verified Dealer, 4.8 stars, 312 reviews, +91 98765 43210"
 * on a car whose dealer does not exist. Two separate inventions produced it,
 * and neither was a display bug — both were the app supplying data nobody
 * entered:
 *
 *   1. `map?.seller_id ?? 1` in getForCar. With no mapping for a car this fell
 *      back to dealer number one. Where a real dealer holds id 1, every
 *      unmapped car in the catalogue was attributed to them, and they would
 *      take calls about stock they have never sold.
 *
 *   2. A hardcoded DUMMY seller substituted when that lookup failed. Every
 *      field invented: a verification badge nobody issued, an average of
 *      reviews nobody wrote, and a phone number a buyer could ring.
 *
 * Both are gone. getForCar returns null, which is the honest answer and a real
 * state rather than an error — a catalogue row is manufacturer stock and has
 * no dealer behind it.
 *
 * WHY THE LAST TEST IS THE IMPORTANT ONE
 *
 * Removing the fabrication is only half the job. If staff were then shown an
 * empty dealer card, the enquiry would go nowhere and the go-live path would
 * be a dead end — quieter than the fake dealer, and just as broken. So the
 * absence of a dealer has to route the buyer to the enquiry form, which is
 * visible to admins (024) and alerts them (025).
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { CarDetailComponent } from './car-detail.component';
import { SellersService, Seller } from '../../services/sellers.service';
import { AuthService } from '../../services/auth.service';

const REAL_DEALER: Seller = {
  id: 4, name: 'A Real Person', business_name: 'A Real Dealership',
  phone: '+919000000000', email: 'real@dealer.example', city: 'Kolkata',
  address: 'Somewhere', verified: true, rating: 4.1, total_reviews: 9,
};

function build(seller: Seller | null, role: string | null): CarDetailComponent {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [CarDetailComponent, RouterTestingModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SellersService, useValue: { getForCar: () => Promise.resolve(seller) } },
      {
        provide: AuthService,
        useValue: {
          currentUser: () => (role ? { role, name: 'Someone', email: 's@example.com' } : null),
          isAdmin: () => role === 'admin',
        },
      },
    ],
  });
  const c = TestBed.createComponent(CarDetailComponent).componentInstance;
  c.car = { id: 'car-1', make: 'Maruti Suzuki', model: 'e Vitara' } as never;
  return c;
}

describe('Contacting the seller when no dealer is onboarded', () => {
  it('sends a signed-out buyer to the enquiry form', async () => {
    // The ordinary case at launch, and the one that already worked.
    const c = build(null, null);

    await c.openContactSeller();

    expect(c.enquiryModalOpen()).withContext('the buyer must reach somebody').toBeTrue();
    expect(c.sellerModalOpen()).toBeFalse();
  });

  it('sends an ADMIN to the enquiry form too, rather than an empty dealer card', async () => {
    // The bug, and the fix. Staff used to get the dealer card unconditionally,
    // which is why the fabricated dealer was visible at all. With no dealer,
    // an empty card would be a dead end on the one path that must work before
    // anybody is onboarded.
    const c = build(null, 'admin');

    await c.openContactSeller();

    expect(c.enquiryModalOpen())
      .withContext('with no dealer, the enquiry must still reach the admin inbox')
      .toBeTrue();
    expect(c.sellerModalOpen())
      .withContext('there is no dealer to show')
      .toBeFalse();
  });

  it('sends a seller with no dealer record to the enquiry form as well', async () => {
    const c = build(null, 'seller');

    await c.openContactSeller();

    expect(c.enquiryModalOpen()).toBeTrue();
    expect(c.sellerModalOpen()).toBeFalse();
  });

  it('never shows a dealer that does not exist', async () => {
    // The invention, pinned. Whatever else changes, an absent dealer must not
    // become a present one — the reported card carried a phone number a buyer
    // could actually ring.
    const c = build(null, 'admin');

    await c.openContactSeller();

    expect(c.seller()).withContext('no dealer means no dealer').toBeNull();
  });
});

describe('Contacting the seller when a dealer IS onboarded', () => {
  it('shows staff the real dealer', async () => {
    // The other half: the fix must not have removed the working behaviour.
    const c = build(REAL_DEALER, 'admin');

    await c.openContactSeller();

    expect(c.sellerModalOpen()).toBeTrue();
    expect(c.enquiryModalOpen()).toBeFalse();
    expect(c.seller()?.business_name).toBe('A Real Dealership');
  });

  it('still sends an ordinary buyer to the enquiry form', async () => {
    // A buyer never gets the dealer's direct line; that is what the enquiry
    // form is for, and a real dealer existing does not change it.
    const c = build(REAL_DEALER, null);

    await c.openContactSeller();

    expect(c.enquiryModalOpen()).toBeTrue();
    expect(c.sellerModalOpen()).toBeFalse();
  });
});
