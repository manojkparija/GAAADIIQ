/**
 * The account-type picker.
 *
 * "Register as a mechanic" led here, and here offered only Customer and
 * Seller — so a mechanic could create an account but had no way to say that
 * was why, and nothing carried them on to the KYC form that actually makes
 * them a mechanic.
 *
 * The picker is also, deliberately, not a list of roles: `admin` is granted
 * by an existing admin against a server-side allowlist and must never be
 * self-selected here. That is asserted, because a future edit adding it would
 * hand anyone the verification queue and every mechanic's KYC.
 */

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { RegisterComponent } from './register.component';
import { AuthService } from '../../services/auth.service';

describe('RegisterComponent account types', () => {
  let fixture: any;
  let component: any;
  let navigatedTo: string | null;

  beforeEach(() => {
    navigatedTo = null;
    TestBed.configureTestingModule({
      imports: [RegisterComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: { register: () => Promise.resolve(), currentUser: () => null },
        },
      ],
    });
    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;
    spyOn(TestBed.inject(Router), 'navigate').and.callFake((cmds: any[]) => {
      navigatedTo = cmds[0];
      return Promise.resolve(true);
    });
  });

  it('offers Mechanic alongside Customer and Seller', () => {
    const values = component.accountTypes.map((t: any) => t.value);
    expect(values).withContext('no way to sign up as a mechanic').toContain('mechanic');
    expect(values).toContain('customer');
    expect(values).toContain('seller');
  });

  it('never offers admin as a self-service choice', () => {
    // Admin comes from the server-side allowlist. A chip here would let anyone
    // award themselves the verification queue and every mechanic's KYC.
    const values = component.accountTypes.map((t: any) => t.value);
    expect(values).not.toContain('admin');
  });

  it('hands a mechanic on to the KYC form after the account is made', async () => {
    // An account alone is not a mechanic: the service area and KYC live on the
    // mechanic record. Landing on the home page leaves registration half done.
    component.accountType.set('mechanic');
    component.name.set('Rakesh Kumar');
    component.email.set('rakesh@example.com');
    component.password.set('a-long-enough-password');
    component.confirmPassword.set('a-long-enough-password');

    await component.onSubmit();

    expect(navigatedTo).toBe('/mechanic-signup');
  });

  it('still sends a seller to the dealer dashboard and a customer home', async () => {
    component.accountType.set('seller');
    component.name.set('S');
    component.email.set('s@example.com');
    component.password.set('a-long-enough-password');
    component.confirmPassword.set('a-long-enough-password');
    await component.onSubmit();
    expect(navigatedTo).toBe('/dealer-dashboard');

    component.accountType.set('customer');
    await component.onSubmit();
    expect(navigatedTo).toBe('/');
  });

  it('skips the car-preferences step for a mechanic', () => {
    // Those questions are for someone buying a car, not repairing one.
    component.accountType.set('mechanic');
    expect(component.isCustomer()).toBe(false);
    expect(component.totalSteps()).toBe(2);
  });

  it('renders a Mechanic chip on the picker', () => {
    // The picker lives on step 1, beside name and email.
    component.step.set(1);
    fixture.detectChanges();
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.role-label'),
    ).map((el: any) => el.textContent.trim());
    expect(labels).toContain('Mechanic');
  });
});
