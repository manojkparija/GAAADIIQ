import { Component, signal, effect, inject } from '@angular/core';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { LogoComponent } from '../../components/logo/logo.component';
import { FormsModule } from '@angular/forms';
import { AuthService, UnconfirmedEmailError } from '../../services/auth.service';
import { IconComponent } from '../../components/icon/icon.component';
import { TranslatePipe } from '../../pipes/translate.pipe';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [LogoComponent, RouterLink, CommonModule, FormsModule, IconComponent, TranslatePipe],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  email = signal('');
  password = signal('');
  loading = signal(false);
  showPass = signal(false);
  error = signal('');
  socialLoading = signal<'google' | 'facebook' | null>(null);
  resetEmail = signal('');
  resetSent = signal(false);
  resetLoading = signal(false);
  resetError = signal('');
  showResetForm = signal(false);

  // ── Mobile sign-in ────────────────────────────────────────────────────────
  //
  // One method for both signing up and signing in, because with a phone there
  // is no difference to expose: Supabase creates the account if the number is
  // new and returns the existing one if it is not. Asking someone to choose
  // between "sign in" and "sign up" would be asking them to remember whether
  // they have been here before, and getting it wrong would be an error we
  // invented.
  //
  // `mode` is which credential the form is collecting, not which action it
  // performs.
  mode = signal<'password' | 'phone'>('password');
  phone = signal('');
  otp = signal('');
  /** Set once the SMS is away; it is also the number the code is checked against. */
  otpSentTo = signal<string | null>(null);
  otpLoading = signal(false);

  private returnUrl = '/';

  constructor(private auth: AuthService, private router: Router, private route: ActivatedRoute) {
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/';
    effect(() => {
      if (this.auth.isLoggedIn()) {
        this.router.navigateByUrl(this.returnUrl);
      }
    });
  }

  toggleShowPass() { this.showPass.set(!this.showPass()); }

  /** Switch which credential the form collects, clearing anything half-typed. */
  setMode(mode: 'password' | 'phone') {
    this.mode.set(mode);
    this.error.set('');
    // Not cleared: `phone`. Someone who typed a number, hit the wrong tab and
    // came back should not have to type it again.
    this.otp.set('');
    this.otpSentTo.set(null);
  }

  async sendOtp() {
    this.error.set('');
    this.otpLoading.set(true);
    try {
      const e164 = await this.auth.sendPhoneOtp(this.phone());
      this.otpSentTo.set(e164);
    } catch (e: any) {
      this.error.set(e.message || 'Could not send the code. Please try again.');
    } finally {
      this.otpLoading.set(false);
    }
  }

  /**
   * Go back to the number field. Without this, a typo in the number is a dead
   * end: the code never arrives and the only way out is a page reload.
   */
  changeNumber() {
    this.otpSentTo.set(null);
    this.otp.set('');
    this.error.set('');
  }

  async verifyOtp() {
    this.error.set('');
    this.otpLoading.set(true);
    try {
      await this.auth.verifyPhoneOtp(this.otpSentTo()!, this.otp());
      // No navigate here: the effect in the constructor watches isLoggedIn and
      // sends them to returnUrl, which is the same path Google and password
      // sign-in take. Navigating here as well would race it.
    } catch (e: any) {
      this.error.set(e.message || 'Could not verify that code. Please try again.');
    } finally {
      this.otpLoading.set(false);
    }
  }

  async loginWithGoogle() {
    this.error.set('');
    this.socialLoading.set('google');
    try {
      await this.auth.loginWithGoogle();
    } catch (e: any) {
      this.error.set(e.message || 'Google sign-in failed. Please try again.');
      this.socialLoading.set(null);
    }
  }

  async loginWithFacebook() {
    this.error.set('');
    this.socialLoading.set('facebook');
    try {
      await this.auth.loginWithFacebook();
    } catch (e: any) {
      this.error.set(e.message || 'Facebook sign-in failed. Please try again.');
      this.socialLoading.set(null);
    }
  }

  openResetForm(e: Event) {
    e.preventDefault();
    this.resetEmail.set(this.email());
    this.resetError.set('');
    this.resetSent.set(false);
    this.showResetForm.set(true);
  }

  closeResetForm() { this.showResetForm.set(false); }

  async onSendReset() {
    if (!this.resetEmail()) { this.resetError.set('Please enter your email address.'); return; }
    this.resetLoading.set(true);
    this.resetError.set('');
    try {
      await this.auth.sendPasswordReset(this.resetEmail());
      this.resetSent.set(true);
    } catch (e: any) {
      this.resetError.set(e.message || 'Failed to send reset email. Please try again.');
    } finally {
      this.resetLoading.set(false);
    }
  }

  /** True when the password was right and only the email is unconfirmed. */
  needsConfirmation = signal(false);
  resendSent = signal(false);
  resendError = signal('');

  async onSubmit() {
    this.error.set('');
    this.needsConfirmation.set(false);
    this.resendSent.set(false);
    this.loading.set(true);
    try {
      await this.auth.login(this.email(), this.password());
      this.router.navigateByUrl(this.returnUrl);
    } catch (e: any) {
      // An unconfirmed address is not a wrong password, and telling someone to
      // check their credentials when the fix is in their inbox leaves them
      // retyping a password that was right the first time.
      if (e instanceof UnconfirmedEmailError) {
        this.needsConfirmation.set(true);
        this.error.set('');
      } else {
        this.error.set(e.message || 'Sign in failed. Please try again.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  async resendConfirmation() {
    this.resendError.set('');
    try {
      await this.auth.resendConfirmation(this.email());
      this.resendSent.set(true);
    } catch (e: any) {
      this.resendError.set(e.message || 'Could not resend. Try again in a moment.');
    }
  }
}
