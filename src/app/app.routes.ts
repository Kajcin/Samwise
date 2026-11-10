import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { LoginComponent } from './login/login.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'plants', canActivate: [authGuard], loadComponent: () => import('./plant-catalog/plant-catalog-list.component').then(m => m.PlantCatalogListComponent) },
  { path: 'plants/:id', canActivate: [authGuard], loadComponent: () => import('./plant-catalog/plant-detail.component').then(m => m.PlantDetailComponent) },
  // Placeholder until Task 13 replaces it with the Dashboard.
  { path: '', canActivate: [authGuard], loadComponent: () => import('./home/home.component').then(m => m.HomeComponent) },
];
