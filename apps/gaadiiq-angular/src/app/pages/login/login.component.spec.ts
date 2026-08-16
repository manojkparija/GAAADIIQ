/**
 * Sign-in error reporting.
 *
 * Reported from production: signed up as a mechanic, then "Incorrect email or
 * password. Please try again." on a password that was correct. Supabase was
 * holding the account for email confirmation, and every one of its errors was
 * being flattened into that single sentence — so the fix (a link sitting in
 * the inbox) was never mentioned, and retrying could not work.
 *
 * The service already had this insight written down, in a comment on the
 * dev-admin branch: "Email not confirmed" and "Invalid login credentials"
 * "need completely different fixes, and without the message the two are
 * indistinguishable from the UI". It just was not applied to the path real
 * users take.
 */

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LoginComponent } from './login.component';
import { AuthService, UnconfirmedEmailError } from '../../services/auth.service';

describe('LoginComponent sign-in errors', () => {
  let fixture: any;
  let component: any;
  let thrown: Error | null;
  let resentTo: string | null;

  beforeEach(() => {
    thrown = null;
    resentTo = null;
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            isLoggedIn: () => false,
            login: () => (thrown ? Promise.reject(thrown) : Promise.resolve()),
            resendConfirmation: (email: string) => {
              resentTo = email;
              return Promise.resolve();
            },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    component.email.set('mk.parija@example.com');
    component.password.set('the-right-password');
  });

  it('does not call an unconfirmed email a wrong password', async () => {
    thrown = new UnconfirmedEmailError('mk.parija@example.com');
    await component.onSubmit();
    fixture.detectChanges();

    expect(component.needsConfirmation()).toBe(true);
    // The red "incorrect password" line must not appear: the password was right.
    expect(component.error()).toBe('');
    expect(fixture.nativeElement.textContent).not.toContain('Incorrect email or password');
    expect(fixture.nativeElement.textContent).toContain('confirm your email');
  });

  it('offers to send the confirmation email again', async () => {
    thrown = new UnconfirmedEmailError('mk.parija@example.com');
    await component.onSubmit();
    fixture.detectChanges();

    const resend = fixture.nativeElement.querySelector('.link-btn') as HTMLButtonElement;
    expect(resend).withContext('no way to resend — "check your inbox" is a dead end').not.toBeNull();

    await component.resendConfirmation();
    expect(resentTo).toBe('mk.parija@example.com');
    expect(component.resendSent()).toBe(true);
  });

  it('still reports a genuinely wrong password as one', async () => {
    thrown = new Error('Incorrect email or password. Please try again.');
    await component.onSubmit();
    fixture.detectChanges();

    expect(component.needsConfirmation()).toBe(false);
    expect(component.error()).toContain('Incorrect email or password');
  });

  it('clears the confirmation state on the next attempt', async () => {
    thrown = new UnconfirmedEmailError('mk.parija@example.com');
    await component.onSubmit();
    expect(component.needsConfirmation()).toBe(true);

    thrown = null;
    await component.onSubmit();
    expect(component.needsConfirmation()).toBe(false);
  });
});
