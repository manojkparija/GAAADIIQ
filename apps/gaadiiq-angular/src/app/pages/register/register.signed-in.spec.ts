/**
 * Someone already signed in must not be offered "Create your account".
 *
 * Reported from the live site: the navbar showed the signed-in user's own name
 * while the page under it invited them to make an account.
 *
 * WHY AN EFFECT AND NOT A ROUTE GUARD
 *
 * This is the whole substance of the fix, so it is what these tests pin.
 *
 * `AuthService.currentUser` starts null and is filled asynchronously — its own
 * constructor calls `getSession()` and hydrates in a later microtask. Anything
 * that reads `isLoggedIn()` once, synchronously, runs while a signed-in user
 * still looks signed out: a route guard, or a check in `ngOnInit`. It lets
 * them through and never reconsiders.
 *
 * That is not a corner case here. It is exactly the path the bug was reported
 * on — a typed URL or a hard refresh, where nothing has hydrated yet. In-app
 * navigation happens to work with either approach, which is what makes the
 * synchronous version look correct while being wrong.
 *
 * So the second test below matters more than the first: it starts signed out,
 * renders, and only then flips the signal, which is the real sequence.
 */

import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { RegisterComponent } from './register.component';
import { AuthService } from '../../services/auth.service';

describe('RegisterComponent — already signed in', () => {
  let fixture: ComponentFixture<RegisterComponent>;
  let navigatedTo: string | null;
  let user: ReturnType<typeof signal<{ email: string } | null>>;

  beforeEach(() => {
    navigatedTo = null;
    user = signal<{ email: string } | null>(null);

    TestBed.configureTestingModule({
      imports: [RegisterComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            currentUser: user,
            // Derived from the signal, exactly as the real service does, so
            // the effect re-runs when the session hydrates.
            isLoggedIn: () => user() !== null,
            register: () => Promise.resolve(true),
          },
        },
      ],
    });

    const router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.callFake((url: any) => {
      navigatedTo = String(url);
      return Promise.resolve(true);
    });

    fixture = TestBed.createComponent(RegisterComponent);
  });

  it('leaves a signed-out visitor on the page', () => {
    fixture.detectChanges();
    expect(navigatedTo).withContext('redirected a signed-out visitor away').toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Create your account');
  });

  it('sends them away once the session hydrates, not just on arrival', () => {
    // The real sequence on a hard refresh: render first, session arrives after.
    fixture.detectChanges();
    expect(navigatedTo).toBeNull();

    user.set({ email: 'manoj@example.com' });
    fixture.detectChanges();

    expect(navigatedTo).withContext('stayed on the signup form while signed in').toBe('/');
  });

  it('sends away a visitor who was already signed in when the page rendered', () => {
    user.set({ email: 'manoj@example.com' });
    fixture.detectChanges();
    expect(navigatedTo).toBe('/');
  });

  it('does not bounce back and forth once redirected', () => {
    // The effect re-runs whenever the signal changes. Navigating is not a
    // signal write, so it cannot loop — asserted rather than assumed, since an
    // effect that triggers itself is a browser-freezing bug, not a test
    // failure.
    user.set({ email: 'manoj@example.com' });
    fixture.detectChanges();
    fixture.detectChanges();

    const router = TestBed.inject(Router);
    expect((router.navigateByUrl as jasmine.Spy).calls.count()).toBe(1);
  });
});
