import { Component, inject, signal } from '@angular/core';
import { IconComponent } from './core/icons/icon.component';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { LanguageService } from './core/i18n/language.service';
import { ConfirmDialogComponent } from './core/confirm/confirm-dialog.component';

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent, ConfirmDialogComponent],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  protected auth = inject(AuthService);
  protected i18n = inject(LanguageService);
  private router = inject(Router);

  /** The navbar's menu on narrow screens (Bootstrap's collapse, toggled without its JavaScript). */
  menuOpen = signal(false);

  async signOut(): Promise<void> {
    this.menuOpen.set(false);
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
