import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent {
  private readonly auth   = inject(AuthService);
  private readonly supa   = inject(SupabaseService);
  private readonly router = inject(Router);

  user = this.auth.currentUser;

  fullName  = signal(this.user()?.full_name ?? '');
  phone     = signal(this.user()?.phone ?? '');
  saving    = signal(false);
  saveMsg   = signal('');
  deleteConfirm = signal(false);
  deleteLoading = signal(false);

  async save() {
    this.saving.set(true);
    this.saveMsg.set('');
    const { error } = await this.supa.client.auth.updateUser({
      data: { full_name: this.fullName(), phone: this.phone() },
    });
    this.saving.set(false);
    this.saveMsg.set(error ? `Error: ${error.message}` : 'Profile updated ✓');
  }

  async deleteAccount() {
    this.deleteLoading.set(true);
    // Calls FastAPI DELETE /auth/me which soft-deletes the user per DPDP
    const session = await this.supa.client.auth.getSession();
    const token = session.data.session?.access_token;
    if (token) {
      try {
        await fetch(`${window.location.origin}/api/auth/me`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch { /* ignore — user is still signed out */ }
    }
    await this.supa.client.auth.signOut();
    this.router.navigate(['/']);
  }
}
