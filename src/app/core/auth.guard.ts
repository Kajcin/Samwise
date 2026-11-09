import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  // Wait for the session to be restored before deciding (see AuthService.whenReady).
  await auth.whenReady();
  if (auth.currentUser()) return true;
  return router.parseUrl('/login');
};
