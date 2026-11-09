import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { LoginComponent } from './login/login.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  // Placeholder until Task 13 replaces it with the Dashboard.
  { path: '', canActivate: [authGuard], loadComponent: () => import('./home/home.component').then(m => m.HomeComponent) },
];
