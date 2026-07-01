import { Component, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [RouterLink, CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  email = signal('');
  password = signal('');
  loading = signal(false);
  showPass = signal(false);
  error = signal('');

  constructor(private auth: AuthService, private router: Router) {}

  toggleShowPass() { this.showPass.set(!this.showPass()); }

  async onSubmit() {
    this.error.set('');
    this.loading.set(true);
    try {
      await this.auth.login(this.email(), this.password());
      this.router.navigate(['/']);
    } catch (e: any) {
      this.error.set(e.message || 'Sign in failed. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
