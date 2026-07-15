import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.scss',
})
export class ResetPasswordComponent implements OnInit {
  password = signal('');
  confirm = signal('');
  showPass = signal(false);
  loading = signal(false);
  error = signal('');
  success = signal(false);
  invalidLink = signal(false);

  constructor(private sb: SupabaseService, private router: Router) {}

  ngOnInit() {
    // Supabase puts the session tokens in the URL hash after a password reset link click.
    // onAuthStateChange fires with event=PASSWORD_RECOVERY when Supabase processes the hash.
    this.sb.client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        // Session is now active — user can set a new password
      }
    });

    // If no hash fragment at all, the link is invalid/expired
    if (!window.location.hash && !window.location.search) {
      this.invalidLink.set(true);
    }
  }

  toggleShowPass() { this.showPass.set(!this.showPass()); }

  async onSubmit() {
    if (this.password().length < 8) {
      this.error.set('Password must be at least 8 characters.');
      return;
    }
    if (this.password() !== this.confirm()) {
      this.error.set('Passwords do not match.');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    try {
      const { error } = await this.sb.client.auth.updateUser({ password: this.password() });
      if (error) throw new Error(error.message);
      this.success.set(true);
      setTimeout(() => this.router.navigate(['/login']), 3000);
    } catch (e: any) {
      this.error.set(e.message || 'Failed to update password. The link may have expired.');
    } finally {
      this.loading.set(false);
    }
  }
}
