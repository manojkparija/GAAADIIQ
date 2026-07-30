import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { HomeComponent } from './home.component';
import { AuthService } from '../../services/auth.service';
import { BrandsService } from '../../services/brands.service';
import { By } from '@angular/platform-browser';

function makeAuthMock(loggedIn: boolean) {
  return {
    isLoggedIn: () => loggedIn,
    currentUser: signal(loggedIn ? { email: 'u@example.com', name: 'User', role: 'user' as const } : null),
    logout: jasmine.createSpy('logout').and.returnValue(Promise.resolve()),
  };
}

describe('HomeComponent — AUTH-01: bottom nav auth branches', () => {
  async function createComponent(loggedIn: boolean) {
    TestBed.configureTestingModule({
      imports: [HomeComponent, RouterTestingModule],
      providers: [
        // HomeComponent pulls in ChatService → DiagnosisService → HttpClient.
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: makeAuthMock(loggedIn) },
        { provide: BrandsService, useValue: { brands: signal([]), loading: signal(false) } },
      ],
    });
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('shows Sign In link when logged out', async () => {
    const fixture = await createComponent(false);
    const signIn = fixture.debugElement.query(By.css('.mobile-bottom-nav a[href="/login"]'));
    expect(signIn).toBeTruthy();
    const accountBtn = fixture.debugElement.query(By.css('.mobile-bottom-nav .nav-account-btn'));
    expect(accountBtn).toBeNull();
  });

  it('shows Account button (not Sign In link) when logged in', async () => {
    const fixture = await createComponent(true);
    const accountBtn = fixture.debugElement.query(By.css('.mobile-bottom-nav .nav-account-btn'));
    expect(accountBtn).toBeTruthy();
    const signInLink = fixture.debugElement.query(By.css('.mobile-bottom-nav a[href="/login"]'));
    expect(signInLink).toBeNull();
  });

  it('opens account sheet when logged-in Account button is clicked', async () => {
    const fixture = await createComponent(true);
    const btn = fixture.debugElement.query(By.css('.nav-account-btn'));
    btn.triggerEventHandler('click', null);
    fixture.detectChanges();
    const sheet = fixture.debugElement.query(By.css('.account-sheet'));
    expect(sheet).toBeTruthy();
  });
});
