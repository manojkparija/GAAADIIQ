import { Component, signal } from '@angular/core';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { IconComponent } from '../../components/icon/icon.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [RouterLink, CommonModule, FormsModule, IconComponent],
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
    if (this.auth.isLoggedIn()) {
      this.router.navigateByUrl(this.returnUrl);
    }
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

  async onSubmit() {
    this.error.set('');
    this.loading.set(true);
    try {
      await this.auth.login(this.email(), this.password());
      this.router.navigateByUrl(this.returnUrl);
    } catch (e: any) {
      this.error.set(e.message || 'Sign in failed. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
