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
