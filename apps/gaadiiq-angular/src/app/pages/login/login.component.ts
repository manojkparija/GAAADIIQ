import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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

  toggleShowPass() {
    this.showPass.set(!this.showPass());
  }

  onSubmit() {
    console.log('Login attempt:', { email: this.email(), password: this.password() });
    this.loading.set(true);
    setTimeout(() => this.loading.set(false), 1500);
  }
}
