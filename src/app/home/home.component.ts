import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';

// Placeholder landing page for signed-in users, so sign-in can be tried end to end
// before the real Dashboard exists. Task 13 points the '' route at DashboardComponent
// and deletes this component.
@Component({
  selector: 'app-home',
  standalone: true,
  template: `
    <main>
      <h1>Samwise</h1>
      <p>Signed in as {{ auth.currentUser()?.email }}</p>
      <button (click)="signOut()">Sign out</button>
    </main>
  `,
})
export class HomeComponent {
  protected auth = inject(AuthService);
  private router = inject(Router);

  async signOut(): Promise<void> {
    await this.auth.signOut();
    this.router.navigateByUrl('/login');
  }
}
