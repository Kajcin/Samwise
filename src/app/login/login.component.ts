import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);

  constructor() {
    // Already signed in (e.g. opened /login directly): go to the app.
    this.auth.whenReady().then(() => {
      if (this.auth.currentUser()) this.router.navigateByUrl('/');
    });
  }

  signIn(): void {
    this.auth.signInWithGoogle();
  }
}
