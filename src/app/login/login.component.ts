import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  // Local development only: email/password login for the user created by `npm run dev:user`.
  protected readonly devEmailLogin = environment.devEmailLogin;
  protected email = signal('dev@samwise.local');
  protected password = signal('');
  protected error = signal<string | null>(null);

  constructor() {
    // Already signed in (e.g. opened /login directly): go to the app.
    this.auth.whenReady().then(() => {
      if (this.auth.currentUser()) this.router.navigateByUrl('/');
    });
  }

  signIn(): void {
    this.auth.signInWithGoogle();
  }

  async devSignIn(event: Event): Promise<void> {
    event.preventDefault();
    const error = await this.auth.signInWithPassword(this.email(), this.password());
    this.error.set(error);
    if (!error) this.router.navigateByUrl('/');
  }
}
